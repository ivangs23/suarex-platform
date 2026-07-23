import { loadTableMenu } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * Cubre el call site real de la carta de la mesa -- que ya no hace el
 * encadenado token -> tenantId -> catálogo inline, sino a través de `loadTableMenu`
 * (`packages/db/src/menu.ts`) -- frente a un regresión concreta: que ese encadenado
 * reciba el `tenantId` EQUIVOCADO (argumentos intercambiados, un id fijo, un
 * copy-paste). Ni `db-repositories.test.ts` (prueba los repos dado CUALQUIER id) ni
 * `tenant-filter-structural.test.ts` (prueba que las queries pasen por `tenantScoped`)
 * cubren ese call site en concreto, y el e2e "no leak" (`qr-order.spec.ts`) es
 * estructuralmente vacuo aquí: la carta solo pinta un producto cuyo `categoryId`
 * coincide con una categoría YA del tenant, así que un producto ajeno de más nunca se
 * ve, pase lo que pase en el catálogo pedido.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let tokenA: string;

afterAll(async () => {
  // Acotado a los dos tenants creados por esta suite (nunca un wipe de `tenants`).
  for (const fixture of [tenantA, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

beforeAll(async () => {
  tenantA = await createTenantFixture(`menu-a-${Date.now()}`);
  tenantB = await createTenantFixture(`menu-b-${Date.now()}`);
  await seedCatalog(tenantA.tenantId, "a");
  await seedCatalog(tenantB.tenantId, "b");

  // seedCatalog no devuelve el token de la mesa que crea (es tenant_id + venue_id +
  // label; el token lo genera el default `gen_random_uuid()` de la columna), así que
  // se lee aquí directamente vía el cliente admin, igual que hace
  // `db-repositories.test.ts` para el `custom_domain` de un tenant.
  const { data, error } = await admin
    .from("tables")
    .select("token")
    .eq("tenant_id", tenantA.tenantId)
    .single();
  if (error) throw error;
  tokenA = data.token as string;
});

describe("loadTableMenu", () => {
  it("dado el token de la mesa de un tenant, devuelve SOLO el catálogo de ese tenant", async () => {
    const menu = await loadTableMenu(tokenA);

    expect(menu).not.toBeNull();
    expect(menu?.table.tenantId).toBe(tenantA.tenantId);

    expect(menu?.categories.map((c) => c.nameI18n.es)).toEqual(["Cat a"]);
    expect(menu?.products.map((p) => p.nameI18n.es)).toEqual(["Prod a"]);

    // Control negativo explícito: nada de B se cuela en la carta de A. No basta con el
    // conteo de arriba (un swap de argumentos podría, en teoría, devolver una lista del
    // mismo tamaño perteneciente a otro tenant); se comprueba el contenido.
    expect(menu?.categories.some((c) => c.nameI18n.es === "Cat b")).toBe(false);
    expect(menu?.products.some((p) => p.nameI18n.es === "Prod b")).toBe(false);
  });
});
