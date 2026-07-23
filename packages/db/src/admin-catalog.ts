import { globalAllergensTable, tenantScoped } from "./client.js";

export type CategoryDestination = "cocina" | "barra";

export type CreateCategoryInput = {
  slug: string;
  nameI18n: Record<string, string>;
  destination?: CategoryDestination;
  parentId?: string | null;
  imageUrl?: string | null;
  sortOrder?: number;
};

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

export type CreateProductInput = {
  categoryId: string;
  nameI18n: Record<string, string>;
  descriptionI18n?: Record<string, string>;
  /** Euros, NO céntimos -- `products.price` es `numeric(10,2)` en euros (ver
   * `supabase/migrations/20260721000002_catalog.sql`), a diferencia de `orders`/
   * `order_items`, que trabajan en céntimos internamente (`@suarex/domain`). */
  price: number;
  /** Ruta devuelta por `uploadProductImage` (`src/storage.ts`), no una URL completa;
   * se guarda tal cual en la columna `image_url`. */
  imagePath?: string | null;
  allergenIds?: number[];
  sortOrder?: number;
};

export type UpdateProductInput = Partial<CreateProductInput>;

export type CreateExtraInput = {
  productId: string;
  nameI18n: Record<string, string>;
  price: number;
};

export type CreateTenantAllergenInput = {
  nameI18n: Record<string, string>;
  icon?: string | null;
};

export type AdminExtra = {
  id: string;
  nameI18n: Record<string, string>;
  price: number;
};

export type AdminProduct = {
  id: string;
  categoryId: string;
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  price: number;
  imageUrl: string | null;
  allergenIds: number[];
  isAvailable: boolean;
  sortOrder: number;
  extras: AdminExtra[];
};

export type AdminCategory = {
  id: string;
  slug: string;
  nameI18n: Record<string, string>;
  /** Categoría padre, o `null` si es raíz. El panel necesita el árbol igual que la carta
   * pública: con 59 categorías en 4 niveles, una lista plana no dice de dónde cuelga cada
   * una y el gestor no encuentra nada. */
  parentId: string | null;
  /** Emoji de la categoría, o `null`. Ayuda a reconocerla de un vistazo en el árbol. */
  icon: string | null;
  destination: CategoryDestination;
  sortOrder: number;
  products: AdminProduct[];
};

export type AdminAllergen = {
  id: number;
  nameI18n: Record<string, string>;
  icon: string | null;
};

export type AdminCatalog = {
  categories: AdminCategory[];
  allergens: AdminAllergen[];
};

/**
 * `products.price`/`product_extras.price` son `numeric(10,2)` EN EUROS (comprobado en
 * `20260721000002_catalog.sql`): el `check (price >= 0)` de la propia columna ya lo
 * exige a nivel de Postgres, pero esta comprobación se hace ANTES de tocar la base de
 * datos -- mismo criterio que `taxRate` en `createPendingOrder`
 * (`src/orders.ts`) -- para no depender únicamente de que Postgres rechace un `NaN`
 * (que compara de forma poco intuitiva contra `>= 0`) y para dar un mensaje claro en
 * vez de un error crudo de postgrest.
 */
function assertValidPrice(price: number): void {
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`Precio inválido (se esperaba un importe en euros >= 0): ${price}`);
  }
}

function categoryInsertValues(input: CreateCategoryInput): Record<string, unknown> {
  return {
    slug: input.slug,
    name_i18n: input.nameI18n,
    destination: input.destination ?? "cocina",
    parent_id: input.parentId ?? null,
    image_url: input.imageUrl ?? null,
    sort_order: input.sortOrder ?? 0,
  };
}

export async function createCategory(
  tenantId: string,
  input: CreateCategoryInput,
): Promise<{ id: string }> {
  const { data, error } = await tenantScoped("categories", tenantId)
    .insert(categoryInsertValues(input))
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function updateCategory(
  tenantId: string,
  categoryId: string,
  patch: UpdateCategoryInput,
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.slug !== undefined) values.slug = patch.slug;
  if (patch.nameI18n !== undefined) values.name_i18n = patch.nameI18n;
  if (patch.destination !== undefined) values.destination = patch.destination;
  if (patch.parentId !== undefined) values.parent_id = patch.parentId;
  if (patch.imageUrl !== undefined) values.image_url = patch.imageUrl;
  if (patch.sortOrder !== undefined) values.sort_order = patch.sortOrder;

  const { error } = await tenantScoped("categories", tenantId).update(values).eq("id", categoryId);
  if (error) throw error;
}

/** `on delete cascade` sobre `category_id`/`product_id` se encarga de productos, extras
 * y de las referencias en `products.allergen_ids` no requiere limpieza (es un array de
 * enteros, no una FK). */
export async function deleteCategory(tenantId: string, categoryId: string): Promise<void> {
  const { error } = await tenantScoped("categories", tenantId).delete().eq("id", categoryId);
  if (error) throw error;
}

export async function createProduct(
  tenantId: string,
  input: CreateProductInput,
): Promise<{ id: string }> {
  assertValidPrice(input.price);

  const { data, error } = await tenantScoped("products", tenantId)
    .insert({
      category_id: input.categoryId,
      name_i18n: input.nameI18n,
      description_i18n: input.descriptionI18n ?? {},
      price: input.price,
      image_url: input.imagePath ?? null,
      allergen_ids: input.allergenIds ?? [],
      sort_order: input.sortOrder ?? 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function updateProduct(
  tenantId: string,
  productId: string,
  patch: UpdateProductInput,
): Promise<void> {
  if (patch.price !== undefined) assertValidPrice(patch.price);

  const values: Record<string, unknown> = {};
  if (patch.categoryId !== undefined) values.category_id = patch.categoryId;
  if (patch.nameI18n !== undefined) values.name_i18n = patch.nameI18n;
  if (patch.descriptionI18n !== undefined) values.description_i18n = patch.descriptionI18n;
  if (patch.price !== undefined) values.price = patch.price;
  if (patch.imagePath !== undefined) values.image_url = patch.imagePath;
  if (patch.allergenIds !== undefined) values.allergen_ids = patch.allergenIds;
  if (patch.sortOrder !== undefined) values.sort_order = patch.sortOrder;

  const { error } = await tenantScoped("products", tenantId).update(values).eq("id", productId);
  if (error) throw error;
}

export async function deleteProduct(tenantId: string, productId: string): Promise<void> {
  const { error } = await tenantScoped("products", tenantId).delete().eq("id", productId);
  if (error) throw error;
}

export async function setProductAvailability(
  tenantId: string,
  productId: string,
  isAvailable: boolean,
): Promise<void> {
  const { error } = await tenantScoped("products", tenantId)
    .update({ is_available: isAvailable })
    .eq("id", productId);
  if (error) throw error;
}

export async function createExtra(
  tenantId: string,
  input: CreateExtraInput,
): Promise<{ id: string }> {
  assertValidPrice(input.price);

  const { data, error } = await tenantScoped("product_extras", tenantId)
    .insert({
      product_id: input.productId,
      name_i18n: input.nameI18n,
      price: input.price,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

export async function deleteExtra(tenantId: string, extraId: string): Promise<void> {
  const { error } = await tenantScoped("product_extras", tenantId).delete().eq("id", extraId);
  if (error) throw error;
}

/**
 * `allergens` admite filas con `tenant_id` propio ADEMÁS de las 14 filas globales de la
 * UE (`tenant_id` NULL, ver `20260721000002_catalog.sql`): un tenant puede declarar sus
 * propios alérgenos personalizados. `tenantScoped` fuerza `tenant_id = tenantId` tanto
 * al leer como al escribir, así que esta función solo puede crear/borrar filas PROPIAS
 * del tenant -- nunca las 14 globales (que no tienen ningún `tenantId` que coincida) ni
 * las de otro tenant.
 */
export async function createTenantAllergen(
  tenantId: string,
  input: CreateTenantAllergenInput,
): Promise<{ id: number }> {
  const { data, error } = await tenantScoped("allergens", tenantId)
    .insert({ name_i18n: input.nameI18n, icon: input.icon ?? null })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as number };
}

export async function deleteTenantAllergen(tenantId: string, allergenId: number): Promise<void> {
  const { error } = await tenantScoped("allergens", tenantId).delete().eq("id", allergenId);
  if (error) throw error;
}

type AdminExtraRow = {
  id: string;
  name_i18n: Record<string, string>;
  price: string | number;
};

type AdminProductRow = {
  id: string;
  category_id: string;
  name_i18n: Record<string, string>;
  description_i18n: Record<string, string>;
  price: string | number;
  image_url: string | null;
  allergen_ids: number[];
  is_available: boolean;
  sort_order: number;
  product_extras: AdminExtraRow[];
};

type AdminCategoryRow = {
  id: string;
  slug: string;
  name_i18n: Record<string, string>;
  parent_id: string | null;
  icon: string | null;
  destination: CategoryDestination;
  sort_order: number;
  products: AdminProductRow[];
};

type AdminAllergenRow = {
  id: number;
  name_i18n: Record<string, string>;
  icon: string | null;
};

/**
 * Lectura acotada al tenant para las pantallas de administración (Task 5): categorías
 * con sus productos y extras embebidos, más los alérgenos PROPIOS del tenant (los 14
 * globales de la UE, con `tenant_id` NULL, quedan fuera de `tenantScoped` a propósito --
 * ver el docstring de `createTenantAllergen` -- porque no son un dato que este
 * repositorio pueda crear/borrar; una pantalla que necesite mostrarlos junto a los
 * propios puede añadir su propia lectura acotada a `tenant_id is null`).
 *
 * A diferencia de `getProducts` (`src/catalog.ts`, usado por la carta pública), aquí NO
 * se filtra `is_available`: un gestor debe poder ver y reactivar un producto oculto.
 */
export async function listAdminCatalog(tenantId: string): Promise<AdminCatalog> {
  const [categoriesResult, allergensResult] = await Promise.all([
    tenantScoped("categories", tenantId)
      .select(
        "id, slug, name_i18n, parent_id, icon, destination, sort_order, " +
          "products(id, category_id, name_i18n, description_i18n, price, image_url, " +
          "allergen_ids, is_available, sort_order, product_extras(id, name_i18n, price))",
      )
      .order("sort_order", { ascending: true }),
    tenantScoped("allergens", tenantId).select("id, name_i18n, icon"),
  ]);
  if (categoriesResult.error) throw categoriesResult.error;
  if (allergensResult.error) throw allergensResult.error;

  const categoryRows = categoriesResult.data as unknown as AdminCategoryRow[];
  const allergenRows = allergensResult.data as unknown as AdminAllergenRow[];

  const categories: AdminCategory[] = categoryRows.map((category) => {
    const products: AdminProduct[] = [...category.products]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((product) => ({
        id: product.id,
        categoryId: product.category_id,
        nameI18n: product.name_i18n,
        descriptionI18n: product.description_i18n,
        price: Number(product.price),
        imageUrl: product.image_url,
        allergenIds: product.allergen_ids,
        isAvailable: product.is_available,
        sortOrder: product.sort_order,
        extras: product.product_extras.map((extra) => ({
          id: extra.id,
          nameI18n: extra.name_i18n,
          price: Number(extra.price),
        })),
      }));

    return {
      id: category.id,
      slug: category.slug,
      nameI18n: category.name_i18n,
      parentId: category.parent_id ?? null,
      icon: category.icon ?? null,
      destination: category.destination,
      sortOrder: category.sort_order,
      products,
    };
  });

  const allergens: AdminAllergen[] = allergenRows.map((allergen) => ({
    id: allergen.id,
    nameI18n: allergen.name_i18n,
    icon: allergen.icon,
  }));

  return { categories, allergens };
}

/**
 * Alérgenos ASIGNABLES a un producto (Task 5): los 14 globales de la UE (`tenant_id`
 * NULL, vía `globalAllergensTable()` -- ver su docstring en `src/client.ts`) MÁS los
 * propios del tenant (vía `tenantScoped`, igual que `listAdminCatalog`). Existe como
 * función separada -- en vez de ampliar `listAdminCatalog` -- porque son dos lecturas
 * con propósitos distintos: `listAdminCatalog` refleja el catálogo TAL CUAL existe hoy
 * (solo lo propio del tenant, para no confundir "mis alérgenos" con "los globales" en
 * la pantalla de gestión de alérgenos propios); esta función responde a una pregunta
 * distinta -- "¿qué alérgenos puede marcar un gestor en el formulario de producto?" --
 * que sí necesita ambos conjuntos combinados.
 */
export async function listAssignableAllergens(tenantId: string): Promise<AdminAllergen[]> {
  const [globalResult, tenantResult] = await Promise.all([
    globalAllergensTable(),
    tenantScoped("allergens", tenantId).select("id, name_i18n, icon"),
  ]);
  if (globalResult.error) throw globalResult.error;
  if (tenantResult.error) throw tenantResult.error;

  const globalRows = globalResult.data as unknown as AdminAllergenRow[];
  const tenantRows = tenantResult.data as unknown as AdminAllergenRow[];

  return [...globalRows, ...tenantRows]
    .sort((a, b) => a.id - b.id)
    .map((allergen) => ({ id: allergen.id, nameI18n: allergen.name_i18n, icon: allergen.icon }));
}
