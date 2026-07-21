import { findTenantByHost, getCategories, getProducts, getTenantSettings } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

const ROOTS = ["localhost", "suarex.app"];
let tenantA: TenantFixture;
let tenantB: TenantFixture;
let customDomain: string;

afterAll(async () => {
  // Acotado a los dos usuarios/tenants creados por esta suite (nunca un wipe de
  // `tenants` o `auth.users`).
  for (const fixture of [tenantA, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

beforeAll(async () => {
  tenantA = await createTenantFixture(`repo-a-${Date.now()}`);
  tenantB = await createTenantFixture(`repo-b-${Date.now()}`);
  await seedCatalog(tenantA.tenantId, "a");
  await seedCatalog(tenantB.tenantId, "b");

  // Único por ejecución: una fila `repo-*` sobrante de una ejecución interrumpida no
  // puede colisionar con la constraint UNIQUE de `tenants.custom_domain`.
  customDomain = `carta-${nonce()}.ejemplo.es`;
  const { error: customDomainError } = await admin
    .from("tenants")
    .update({ custom_domain: customDomain })
    .eq("id", tenantB.tenantId);
  if (customDomainError) throw customDomainError;
});

describe("findTenantByHost", () => {
  it("resuelve por subdominio", async () => {
    const tenant = await findTenantByHost(`${tenantA.slug}.suarex.app`, ROOTS);
    expect(tenant?.id).toBe(tenantA.tenantId);
  });

  it("resuelve por dominio propio", async () => {
    const tenant = await findTenantByHost(customDomain, ROOTS);
    expect(tenant?.id).toBe(tenantB.tenantId);
  });

  it("devuelve null para un host desconocido", async () => {
    expect(await findTenantByHost("nadie.suarex.app", ROOTS)).toBeNull();
  });

  it("devuelve null para el dominio raíz", async () => {
    expect(await findTenantByHost("suarex.app", ROOTS)).toBeNull();
  });
});

describe("repositorios de catálogo", () => {
  it("getCategories solo devuelve las del tenant pedido", async () => {
    const categories = await getCategories(tenantA.tenantId);
    expect(categories).toHaveLength(1);
    expect(categories[0]?.nameI18n.es).toBe("Cat a");
  });

  it("getProducts solo devuelve los del tenant pedido", async () => {
    const products = await getProducts(tenantB.tenantId);
    expect(products).toHaveLength(1);
    expect(products[0]?.nameI18n.es).toBe("Prod b");
    expect(products[0]?.price).toBe(9.5);
  });

  it("getTenantSettings devuelve la marca del tenant", async () => {
    const settings = await getTenantSettings(tenantA.tenantId);
    expect(settings?.branding).toMatchObject({ colors: { primary: "#000000" } });
  });

  it("getTenantSettings degrada campo a campo un valor corrupto, sin blanquear el resto de la fila", async () => {
    // `channels` con un valor fuera del enum de tenantSettingsSchema (drift de datos: hoy
    // no hay ningún camino de escritura autenticado hacia esta tabla, pero un futuro CRUD
    // de administración podría producirlo). Escrito directamente vía admin porque un
    // valor así nunca pasaría por un `.insert()`/`.update()` tipado normal de la app.
    const { error: corruptError } = await admin
      .from("tenant_settings")
      .update({ channels: ["canal-inventado"], locale: "es" })
      .eq("tenant_id", tenantA.tenantId);
    if (corruptError) throw corruptError;

    const settings = await getTenantSettings(tenantA.tenantId);
    // El campo corrupto degrada a su default...
    expect(settings?.channels).toEqual([]);
    // ...pero locale (válido) y branding (fuera del alcance de este schema) sobreviven
    // intactos: una fila con un solo campo corrupto no se blanquea entera.
    expect(settings?.locale).toBe("es");
    expect(settings?.branding).toMatchObject({ colors: { primary: "#000000" } });
  });
});
