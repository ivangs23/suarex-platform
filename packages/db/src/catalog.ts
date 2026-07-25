import { tenantScoped } from "./client.js";
import type { Category, Product, ProductExtra } from "./types.js";

type ProductExtraRow = {
  id: string;
  name_i18n: Record<string, string>;
  price: string | number;
  group_id: string | null;
};

type OptionGroupRow = {
  id: string;
  name_i18n: Record<string, string>;
  min_select: number;
  max_select: number;
  sort_order: number;
};

export async function getCategories(tenantId: string): Promise<Category[]> {
  const { data, error } = await tenantScoped("categories", tenantId)
    .select("id, slug, name_i18n, icon, image_url, sort_order, parent_id")
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    nameI18n: row.name_i18n as Record<string, string>,
    icon: (row.icon as string | null) ?? null,
    imagePath: (row.image_url as string | null) ?? null,
    sortOrder: row.sort_order as number,
    // `categories.parent_id` (FK auto-referenciada, ver 20260721000002_catalog.sql)
    // permite cartas en ÁRBOL: una carta grande se navega por niveles en vez de volcar
    // cientos de productos en una lista. `null` = categoría raíz.
    parentId: (row.parent_id as string | null) ?? null,
  }));
}

/**
 * `product_extras(...)` va incrustado vía el FK `product_extras.product_id ->
 * products.id`: PostgREST resuelve ese "has many" sin que haga falta un segundo
 * filtro de tenant aquí, porque el nivel superior (`products`) YA está acotado por
 * `tenantScoped` -- una extra de otro tenant nunca puede colgar de un producto de
 * ESTE tenant (lo impone el trigger `assert_same_tenant` en la propia tabla).
 */
export async function getProducts(tenantId: string): Promise<Product[]> {
  const { data, error } = await tenantScoped("products", tenantId)
    // Una sola cadena LITERAL, sin concatenar: supabase-js deduce el tipo de la fila leyendo
    // este texto en tiempo de compilación, y un `+` por en medio lo deja sin poder hacerlo (la
    // fila pasa a `GenericStringError` y revienta cada acceso a una columna).
    .select(
      "id, category_id, name_i18n, description_i18n, price, image_url, allergen_ids, is_available, sort_order, product_extras(id, name_i18n, price, group_id), product_option_groups(id, name_i18n, min_select, max_select, sort_order)",
    )
    .eq("is_available", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const extraRows = (row.product_extras ?? []) as unknown as ProductExtraRow[];
    const extras: ProductExtra[] = extraRows.map((extra) => ({
      id: extra.id,
      nameI18n: extra.name_i18n,
      price: Number(extra.price),
      groupId: extra.group_id ?? null,
    }));

    /* Los grupos llegan con SUS opciones ya dentro (#16). La ficha del producto tiene que pintar
       "elige el punto de la carne" como una unidad, y el servidor tiene que validarla igual, así
       que la pertenencia se resuelve UNA vez aquí en vez de cruzarla en cada consumidor.
       El orden es el que fijó el gestor: un menú del día se lee primero -> segundo -> postre, y
       dejarlo al orden en que la base devuelva las filas lo barajaría en cada carga. */
    const groupRows = (row.product_option_groups ?? []) as unknown as OptionGroupRow[];
    const optionGroups = groupRows
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((group) => ({
        id: group.id,
        nameI18n: group.name_i18n,
        minSelect: group.min_select,
        maxSelect: group.max_select,
        sortOrder: group.sort_order,
        options: extras.filter((extra) => extra.groupId === group.id),
      }));

    return {
      id: row.id as string,
      categoryId: row.category_id as string,
      nameI18n: row.name_i18n as Record<string, string>,
      descriptionI18n: row.description_i18n as Record<string, string>,
      price: Number(row.price),
      imagePath: (row.image_url as string | null) ?? null,
      allergenIds: (row.allergen_ids as number[] | null) ?? [],
      isAvailable: row.is_available as boolean,
      sortOrder: row.sort_order as number,
      extras,
      optionGroups,
    };
  });
}
