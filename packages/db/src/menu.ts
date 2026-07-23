import { getCategories, getProducts } from "./catalog.js";
import { findTableByToken } from "./tables.js";
import { getTenantSettings } from "./tenants.js";
import type { Category, Product, TableRow, TenantSettingsRow } from "./types.js";

export type TableMenu = {
  table: TableRow;
  categories: Category[];
  products: Product[];
  settings: TenantSettingsRow | null;
};

/**
 * Único punto de entrada que resuelve el token de una mesa hasta su carta completa
 * (catálogo + ajustes de marca/moneda del tenant). Existe para que la cadena
 * token -> tenantId -> catálogo sea una unidad comprobable por un test de integración:
 * antes, la carta de la mesa hacía este encadenado inline, y nada cubría
 * que `getCategories`/`getProducts` recibieran el `tenantId` correcto -- solo que, dado
 * CUALQUIER id, la consulta resultante estuviera bien acotada (`db-repositories.test.ts`)
 * y que las consultas pasen por `tenantScoped` (`tenant-filter-structural.test.ts`). Un
 * id trocado justo en ese call site -- argumentos intercambiados, un id fijo, un
 * copy-paste -- no lo detectaba nada de eso, y el e2e "no leak" tampoco: la carta
 * solo pinta un producto cuyo `categoryId` coincide con una categoría YA del tenant, así
 * que un producto ajeno filtrado de más nunca se ve, sea cual sea el conteo.
 */
export async function loadTableMenu(token: string): Promise<TableMenu | null> {
  const table = await findTableByToken(token);
  if (!table?.isActive) return null;

  const [categories, products, settings] = await Promise.all([
    getCategories(table.tenantId),
    getProducts(table.tenantId),
    getTenantSettings(table.tenantId),
  ]);

  return { table, categories, products, settings };
}
