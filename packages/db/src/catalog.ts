import { serviceClient } from "./client.js";
import type { Category, Product } from "./types.js";

export async function getCategories(tenantId: string): Promise<Category[]> {
  const { data, error } = await serviceClient()
    .from("categories")
    .select("id, slug, name_i18n, sort_order")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    nameI18n: row.name_i18n as Record<string, string>,
    sortOrder: row.sort_order as number,
  }));
}

export async function getProducts(tenantId: string): Promise<Product[]> {
  const { data, error } = await serviceClient()
    .from("products")
    .select("id, category_id, name_i18n, description_i18n, price, is_available, sort_order")
    .eq("tenant_id", tenantId)
    .eq("is_available", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    categoryId: row.category_id as string,
    nameI18n: row.name_i18n as Record<string, string>,
    descriptionI18n: row.description_i18n as Record<string, string>,
    price: Number(row.price),
    isAvailable: row.is_available as boolean,
    sortOrder: row.sort_order as number,
  }));
}
