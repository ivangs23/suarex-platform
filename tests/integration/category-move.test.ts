import { createCategory, listCategoryParents, updateCategory } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * Mover categorías por el árbol.
 *
 * `categories.parent_id` es una clave ajena a la PROPIA tabla: Postgres acepta `a → b → a`
 * sin rechistar. Un ciclo no da error -- deja una rama inalcanzable desde la raíz, con sus
 * productos fuera de la carta sin que nadie los haya borrado. Estas pruebas fijan que la
 * base efectivamente NO lo impide (de ahí que la guarda tenga que estar en el código) y que
 * mover por caminos legítimos funciona.
 */
describe("mover categorías", () => {
  let tenant: TenantFixture;
  const suffix = nonce();
  let vinos = "";
  let rioja = "";
  let blancos = "";

  beforeAll(async () => {
    tenant = await createTenantFixture(`mov-${suffix}`);
    ({ id: vinos } = await createCategory(tenant.tenantId, {
      slug: `vinos-${suffix}`,
      nameI18n: { es: "Vinos" },
    }));
    ({ id: rioja } = await createCategory(tenant.tenantId, {
      slug: `rioja-${suffix}`,
      nameI18n: { es: "Rioja" },
      parentId: vinos,
    }));
    ({ id: blancos } = await createCategory(tenant.tenantId, {
      slug: `blancos-${suffix}`,
      nameI18n: { es: "Blancos" },
      parentId: rioja,
    }));
  });

  afterAll(async () => {
    await deleteTenantFixture(tenant);
  });

  it("devuelve el esqueleto del árbol para poder comprobar ciclos", async () => {
    const arbol = await listCategoryParents(tenant.tenantId);
    const porId = new Map(arbol.map((c) => [c.id, c.parentId]));
    expect(porId.get(vinos)).toBeNull();
    expect(porId.get(rioja)).toBe(vinos);
    expect(porId.get(blancos)).toBe(rioja);
  });

  it("mueve una categoría a otro padre", async () => {
    await updateCategory(tenant.tenantId, blancos, { parentId: vinos });
    const arbol = await listCategoryParents(tenant.tenantId);
    expect(arbol.find((c) => c.id === blancos)?.parentId).toBe(vinos);

    // Se deja como estaba para el resto de pruebas.
    await updateCategory(tenant.tenantId, blancos, { parentId: rioja });
  });

  it("saca una categoría a la raíz", async () => {
    await updateCategory(tenant.tenantId, blancos, { parentId: null });
    const arbol = await listCategoryParents(tenant.tenantId);
    expect(arbol.find((c) => c.id === blancos)?.parentId).toBeNull();

    await updateCategory(tenant.tenantId, blancos, { parentId: rioja });
  });

  it("la BASE no impide un ciclo: por eso la guarda vive en el código", async () => {
    // Control que justifica `wouldCreateCycle`. Si algún día se añade una restricción en
    // Postgres, este test fallará y será la señal de que la guarda ya no está sola.
    await updateCategory(tenant.tenantId, vinos, { parentId: blancos });

    const arbol = await listCategoryParents(tenant.tenantId);
    const porId = new Map(arbol.map((c) => [c.id, c.parentId]));
    // vinos → blancos → rioja → vinos: ciclo cerrado, y Postgres lo aceptó.
    expect(porId.get(vinos)).toBe(blancos);
    expect(porId.get(blancos)).toBe(rioja);
    expect(porId.get(rioja)).toBe(vinos);

    await updateCategory(tenant.tenantId, vinos, { parentId: null });
  });

  it("cambia el orden entre hermanas", async () => {
    await updateCategory(tenant.tenantId, rioja, { sortOrder: 7 });
    const { data } = await admin.from("categories").select("sort_order").eq("id", rioja).single();
    expect(data?.sort_order).toBe(7);
  });
});
