import { destinationsMissingPrinter } from "@suarex/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

const fixtures: TenantFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await deleteTenantFixture(f);
});

async function seedVenue(tenant: TenantFixture): Promise<string> {
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  return venue?.id as string;
}

describe("destinationsMissingPrinter", () => {
  it("avisa de un destino que la carta usa pero sin impresora habilitada", async () => {
    const tenant = await createTenantFixture(`cov-${nonce()}`);
    fixtures.push(tenant);
    await seedVenue(tenant);
    // La carta usa cocina...
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId,
      slug: `k-${nonce()}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    });
    // ...pero no hay ninguna impresora.
    expect(await destinationsMissingPrinter(tenant.tenantId)).toEqual(["cocina"]);
  });

  it("no avisa cuando el destino tiene una impresora habilitada", async () => {
    const tenant = await createTenantFixture(`cov2-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId,
      slug: `k-${nonce()}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    });
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Cocina",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
      destination: "cocina",
      enabled: true,
    });
    expect(await destinationsMissingPrinter(tenant.tenantId)).toEqual([]);
  });

  it("una impresora 'all' cubre cualquier destino usado", async () => {
    const tenant = await createTenantFixture(`cov3-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId,
      slug: `b-${nonce()}`,
      name_i18n: { es: "Barra" },
      destination: "barra",
    });
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Todo",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
      destination: "all",
      enabled: true,
    });
    expect(await destinationsMissingPrinter(tenant.tenantId)).toEqual([]);
  });

  it("una impresora deshabilitada no cubre", async () => {
    const tenant = await createTenantFixture(`cov4-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId,
      slug: `k-${nonce()}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    });
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Cocina apagada",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
      destination: "cocina",
      enabled: false,
    });
    expect(await destinationsMissingPrinter(tenant.tenantId)).toEqual(["cocina"]);
  });
});
