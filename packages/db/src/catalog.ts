import { tenantScoped } from "./client.js";
import type { Category, Product, ProductExtra } from "./types.js";

type ProductExtraRow = {
  id: string;
  name_i18n: Record<string, string>;
  price: string | number;
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
    .select(
      "id, category_id, name_i18n, description_i18n, price, image_url, is_available, sort_order, product_extras(id, name_i18n, price)",
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
    }));

    return {
      id: row.id as string,
      categoryId: row.category_id as string,
      nameI18n: row.name_i18n as Record<string, string>,
      descriptionI18n: row.description_i18n as Record<string, string>,
      price: Number(row.price),
      imagePath: (row.image_url as string | null) ?? null,
      isAvailable: row.is_available as boolean,
      sortOrder: row.sort_order as number,
      extras,
    };
  });
}
