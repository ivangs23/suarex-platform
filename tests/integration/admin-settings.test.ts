import { getTenantSettings, updateTenantSettings } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  signInAs,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let tenantFresh: TenantFixture;
const staffUserIds: string[] = [];

beforeAll(async () => {
  tenantA = await createTenantFixture(`set-a-${nonce()}`);
  tenantB = await createTenantFixture(`set-b-${nonce()}`);
  await seedCatalog(tenantA.tenantId, "sa");
  await seedCatalog(tenantB.tenantId, "sb");
  // Sin seedCatalog: este tenant NO tiene fila en tenant_settings, a diferencia
  // de tenantA/tenantB. Cubre la rama INSERT del upsert de updateTenantSettings
  // (ver test "crea la fila de settings si el tenant aún no tiene una").
  tenantFresh = await createTenantFixture(`set-fresh-${nonce()}`);
});

afterAll(async () => {
  for (const id of staffUserIds) await deleteMembershipFixtureUser(id);
  if (tenantA) await deleteTenantFixture(tenantA);
  if (tenantB) await deleteTenantFixture(tenantB);
  if (tenantFresh) await deleteTenantFixture(tenantFresh);
});

describe("updateTenantSettings", () => {
  it("escribe branding/fiscal/locale/currency y getTenantSettings los lee de vuelta", async () => {
    await updateTenantSettings(tenantA.tenantId, {
      branding: { name: "Casa A", colors: { primary: "#123456" } },
      fiscal: { legalName: "Casa A SL", taxRate: 0.1 },
      locale: "en",
      currency: "USD",
    });
    const settings = await getTenantSettings(tenantA.tenantId);
    expect(settings?.branding).toMatchObject({ name: "Casa A" });
    expect(settings?.fiscal).toMatchObject({ legalName: "Casa A SL", taxRate: 0.1 });
    expect(settings?.locale).toBe("en");
    expect(settings?.currency).toBe("USD");
  });

  it("crea la fila de settings si el tenant aún no tiene una (rama INSERT del upsert)", async () => {
    await updateTenantSettings(tenantFresh.tenantId, {
      branding: { name: "Nuevo" },
      fiscal: {},
      locale: "es",
      currency: "EUR",
    });
    const settings = await getTenantSettings(tenantFresh.tenantId);
    expect(settings?.branding).toMatchObject({ name: "Nuevo" });
    expect(settings?.locale).toBe("es");
    expect(settings?.currency).toBe("EUR");
  });

  it("no toca los ajustes de otro tenant", async () => {
    const before = await getTenantSettings(tenantB.tenantId);
    await updateTenantSettings(tenantA.tenantId, {
      branding: { name: "Solo A" },
      fiscal: {},
      locale: "es",
      currency: "EUR",
    });
    const after = await getTenantSettings(tenantB.tenantId);
    expect(after?.branding).toEqual(before?.branding);
  });

  it("RLS: un staff autenticado NO puede UPDATE directo de tenant_settings (PostgREST)", async () => {
    const staff = await signInAs(tenantA.tenantId, "staff");
    staffUserIds.push(staff.userId);
    const { error } = await staff
      .from("tenant_settings")
      .update({ locale: "fr" })
      .eq("tenant_id", tenantA.tenantId);
    // RLS lo bloquea: cero filas afectadas (no error) o error de policy. Verificamos
    // que el valor NO cambió, que es la garantía que importa.
    const after = await getTenantSettings(tenantA.tenantId);
    expect(after?.locale).not.toBe("fr");
    void error;
  });

  it("RLS: un owner autenticado SÍ puede UPDATE directo (control positivo)", async () => {
    const owner = await signInAs(tenantA.tenantId, "owner");
    staffUserIds.push(owner.userId);
    const { error } = await owner
      .from("tenant_settings")
      .update({ locale: "pt" })
      .eq("tenant_id", tenantA.tenantId);
    expect(error).toBeNull();
    const after = await getTenantSettings(tenantA.tenantId);
    expect(after?.locale).toBe("pt");
  });
});
