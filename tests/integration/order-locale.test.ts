import { getOrderLocale } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * La pantalla de estado del pedido formateaba el total con un locale fijo `es-ES`: un cliente
 * en portugués o inglés veía su cuenta con formato español. `getOrderLocale` resuelve el
 * locale del cliente dueño del pedido, para pasárselo al formateador.
 */

let tenant: TenantFixture;
let venueId: string;

afterAll(async () => {
  if (tenant) await deleteTenantFixture(tenant);
});

beforeAll(async () => {
  tenant = await createTenantFixture(`locale-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
  // El cliente tiene locale en_GB, no el es por defecto.
  await admin
    .from("tenant_settings")
    .insert({ tenant_id: tenant.tenantId, branding: {}, locale: "en-GB", currency: "EUR" });
});

async function insertOrder(token: string): Promise<void> {
  const { error } = await admin.from("orders").insert({
    tenant_id: tenant.tenantId,
    venue_id: venueId,
    order_number: 1,
    status: "paid",
    public_token: token,
  });
  if (error) throw error;
}

describe("getOrderLocale", () => {
  it("devuelve el locale del cliente dueño del pedido, no uno fijo", async () => {
    const token = crypto.randomUUID();
    await insertOrder(token);
    expect(await getOrderLocale(token)).toBe("en-GB");
  });

  it("un token inexistente cae a 'es' en vez de romper la pantalla de estado", async () => {
    expect(await getOrderLocale(crypto.randomUUID())).toBe("es");
  });
});
