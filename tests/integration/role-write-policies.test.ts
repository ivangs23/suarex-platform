import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  type SignedInClient,
  signInAs,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * D1 tarea 1: generaliza el patrón del rol `device` (20260722000005_device_rls_hardening.sql)
 * a los roles humanos. Las tablas de CONFIGURACIÓN pasan a: lectura para todo el tenant,
 * escritura solo para owner/admin. `staff` deja de poder escribir catálogo, pero conserva
 * intacta su operativa sobre `orders` (tablero de comandas de la fase B) -- ver el test de
 * regresión más abajo. Los 14 alérgenos globales de la UE (`tenant_id IS NULL`) siguen
 * intocables por cualquier autenticado, `owner` incluido.
 */

let tenant: TenantFixture;
let staffClient: SignedInClient;

afterAll(async () => {
  // Acotado a los usuarios que ESTE fichero crea: la membership owner de
  // createTenantFixture (borrada en cascada por deleteTenantFixture) y el usuario staff
  // dado de alta vía signInAs.
  if (staffClient) await deleteMembershipFixtureUser(staffClient.userId);
  if (tenant) await deleteTenantFixture(tenant);
});

beforeAll(async () => {
  tenant = await createTenantFixture(`role-${nonce()}`); // owner
  staffClient = await signInAs(tenant.tenantId, "staff");
});

describe("escritura de catálogo por rol", () => {
  it("un owner PUEDE crear una categoría", async () => {
    const { error } = await tenant.client
      .from("categories")
      .insert({ tenant_id: tenant.tenantId, slug: `c-${nonce()}`, name_i18n: { es: "Vinos" } });
    expect(error).toBeNull();
  });

  it("un staff SIGUE pudiendo leer el catálogo de su tenant (el menú debe poder renderizarse)", async () => {
    // Sembrada vía admin (no depende del orden de otros tests de este fichero) para que
    // el control positivo de abajo sea inequívoco.
    const { data: seeded } = await admin
      .from("categories")
      .insert({ tenant_id: tenant.tenantId, slug: `read-${nonce()}`, name_i18n: { es: "Lectura" } })
      .select("id")
      .single();

    const { data, error } = await staffClient.from("categories").select("id").eq("id", seeded?.id);
    expect(error).toBeNull();
    // Control positivo: la categoría sembrada debe ser visible para staff -- descarta
    // que un `using (false)` disfrazado pase en falso.
    expect(data).toHaveLength(1);
  });

  it("un staff NO puede crear una categoría", async () => {
    const { error } = await staffClient
      .from("categories")
      .insert({ tenant_id: tenant.tenantId, slug: `c-${nonce()}`, name_i18n: { es: "Intento" } });
    expect(error?.code).toBe("42501");
  });

  it("un staff NO puede borrar un producto", async () => {
    const { data: cat } = await admin
      .from("categories")
      .insert({ tenant_id: tenant.tenantId, slug: `c-${nonce()}`, name_i18n: { es: "X" } })
      .select("id")
      .single();
    const { data: prod } = await admin
      .from("products")
      .insert({
        tenant_id: tenant.tenantId,
        category_id: cat?.id,
        name_i18n: { es: "P" },
        price: 1,
      })
      .select("id")
      .single();

    await staffClient.from("products").delete().eq("id", prod?.id);
    // RLS: 0 filas afectadas o permiso denegado; nunca borra.
    const { data: still } = await admin.from("products").select("id").eq("id", prod?.id);
    expect(still).toHaveLength(1);
  });

  it("REGRESIÓN: un staff SIGUE pudiendo marcar una comanda (opera en orders)", async () => {
    const { data: venue } = await admin
      .from("venues")
      .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: false })
      .select("id")
      .single();
    const { data: order } = await admin
      .from("orders")
      .insert({
        tenant_id: tenant.tenantId,
        venue_id: venue?.id,
        order_number: 1,
        status: "paid",
        kitchen_status: "pending",
      })
      .select("id")
      .single();

    const { error } = await staffClient
      .from("orders")
      .update({ kitchen_status: "done" })
      .eq("id", order?.id);
    expect(error).toBeNull();
  });

  it("un owner NO puede modificar un alérgeno global de la UE", async () => {
    const { data: global } = await admin
      .from("allergens")
      .select("id")
      .is("tenant_id", null)
      .limit(1)
      .single();
    await tenant.client.from("allergens").update({ icon: "hackeado" }).eq("id", global?.id);
    // El predicado tenant_id = current_tenant_id() excluye los NULL globales.
    const { data: intact } = await admin
      .from("allergens")
      .select("icon")
      .eq("id", global?.id)
      .single();
    expect(intact?.icon).not.toBe("hackeado");
  });
});
