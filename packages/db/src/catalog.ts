import { filtrarAgotados } from "./agotado.js";
import { tenantScoped } from "./client.js";
import { filtrarPorFranja, minutosEnZona } from "./franjas.js";
import { textosJson } from "./json.js";
import type { Category, Product, ProductExtra, ProductoCarta } from "./types.js";
import { zonaHorariaDelTenant } from "./venues.js";

/** Las categorías que toca ver AHORA, con la franja ya aplicada. */
export async function getCategories(tenantId: string): Promise<Category[]> {
  const { categories, timezone } = await getCategoriesSinFiltroHorario(tenantId);
  return filtrarPorFranja(categories, minutosEnZona(new Date(), timezone));
}

/**
 * Todas las categorías, SIN aplicar la franja, con la zona de la sede para aplicarla después.
 * Es la parte que no depende del reloj: la que puede cachearse (`apps/web/lib/carta-cache.ts`).
 */
export async function getCategoriesSinFiltroHorario(
  tenantId: string,
): Promise<{ categories: Category[]; timezone: string }> {
  // La zona va EN PARALELO con el catálogo, no antes: encadenarlas añadiría un viaje a la
  // latencia de la carta, que es lo primero que ve el comensal con el móvil en la mano.
  const [{ data, error }, timezone] = await Promise.all([
    tenantScoped("categories", tenantId)
      .select(
        "id, slug, name_i18n, icon, image_url, sort_order, parent_id, visible_desde, visible_hasta",
      )
      .order("sort_order", { ascending: true }),
    zonaHorariaDelTenant(tenantId),
  ]);

  if (error) throw error;

  const categorias = data.map((row) => ({
    id: row.id,
    slug: row.slug,
    nameI18n: textosJson(row.name_i18n),
    icon: row.icon,
    imagePath: row.image_url,
    sortOrder: row.sort_order,
    // `categories.parent_id` (FK auto-referenciada, ver 20260721000002_catalog.sql)
    // permite cartas en ÁRBOL: una carta grande se navega por niveles en vez de volcar
    // cientos de productos en una lista. `null` = categoría raíz.
    parentId: row.parent_id,
    // Franja horaria de la categoría (`null` = siempre visible). Viaja en el tipo, y no solo
    // se usa para filtrar aquí, porque el panel necesita leerla para poder editarla.
    visibleDesde: row.visible_desde,
    visibleHasta: row.visible_hasta,
  }));

  // La franja se aplica fuera y no en la consulta: una que cruza medianoche (cena de 20:00 a
  // 02:00) no es un `between`, y PostgREST no sabe expresarla.
  return { categories: categorias, timezone };
}

/**
 * `product_extras(...)` va incrustado vía el FK `product_extras.product_id ->
 * products.id`: PostgREST resuelve ese "has many" sin que haga falta un segundo
 * filtro de tenant aquí, porque el nivel superior (`products`) YA está acotado por
 * `tenantScoped` -- una extra de otro tenant nunca puede colgar de un producto de
 * ESTE tenant (lo impone el trigger `assert_same_tenant` en la propia tabla).
 */
export async function getProducts(tenantId: string): Promise<Product[]> {
  return filtrarAgotados(await getProductsSinFiltroHorario(tenantId), new Date());
}

/**
 * Los productos en carta (`is_available`) INCLUIDOS los agotados hoy, con su hora de vuelta.
 * Como `getCategoriesSinFiltroHorario`: lo que no depende del reloj, para poder cachearlo; el
 * agotado se filtra fuera (`filtrarAgotados`), porque vuelve solo sin escritura que avise.
 */
export async function getProductsSinFiltroHorario(tenantId: string): Promise<ProductoCarta[]> {
  const { data, error } = await tenantScoped("products", tenantId)
    // Una sola cadena LITERAL, sin concatenar: supabase-js deduce el tipo de la fila leyendo
    // este texto en tiempo de compilación, y un `+` por en medio lo deja sin poder hacerlo (la
    // fila pasa a `GenericStringError` y revienta cada acceso a una columna).
    .select(
      "id, category_id, name_i18n, description_i18n, price, image_url, allergen_ids, is_available, unavailable_until, sort_order, product_extras(id, name_i18n, price, group_id), product_option_groups(id, name_i18n, min_select, max_select, sort_order)",
    )
    .eq("is_available", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return data.map((row) => {
    const extras: ProductExtra[] = row.product_extras.map((extra) => ({
      id: extra.id,
      nameI18n: textosJson(extra.name_i18n),
      price: Number(extra.price),
      groupId: extra.group_id,
    }));

    /* Los grupos llegan con SUS opciones ya dentro (#16). La ficha del producto tiene que pintar
       "elige el punto de la carne" como una unidad, y el servidor tiene que validarla igual, así
       que la pertenencia se resuelve UNA vez aquí en vez de cruzarla en cada consumidor.
       El orden es el que fijó el gestor: un menú del día se lee primero -> segundo -> postre, y
       dejarlo al orden en que la base devuelva las filas lo barajaría en cada carga. */
    const optionGroups = row.product_option_groups
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((group) => ({
        id: group.id,
        nameI18n: textosJson(group.name_i18n),
        minSelect: group.min_select,
        maxSelect: group.max_select,
        sortOrder: group.sort_order,
        options: extras.filter((extra) => extra.groupId === group.id),
      }));

    return {
      id: row.id,
      categoryId: row.category_id,
      nameI18n: textosJson(row.name_i18n),
      descriptionI18n: textosJson(row.description_i18n),
      price: Number(row.price),
      imagePath: row.image_url,
      allergenIds: row.allergen_ids ?? [],
      isAvailable: row.is_available,
      unavailableUntil: row.unavailable_until,
      sortOrder: row.sort_order,
      extras,
      optionGroups,
    };
  });
}
