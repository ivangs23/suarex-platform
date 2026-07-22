import { destinationsMissingPrinter, usbPrintersWithoutDevice } from "@suarex/db";
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
    const venueId = await seedVenue(tenant);
    // La carta usa cocina...
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId,
      slug: `k-${nonce()}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    });
    // ...pero no hay ninguna impresora.
    const gaps = await destinationsMissingPrinter(tenant.tenantId);
    expect(gaps).toEqual([{ venueId, venueName: "V", destinations: ["cocina"] }]);
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
    const gaps = await destinationsMissingPrinter(tenant.tenantId);
    expect(gaps).toEqual([{ venueId, venueName: "V", destinations: ["cocina"] }]);
  });

  /**
   * Finding 2 de la revisión final whole-branch (spec línea ~112, "por local"): dos
   * locales del MISMO tenant, la carta usa cocina, solo V1 tiene impresora de cocina
   * habilitada. Contra el código ANTERIOR (cobertura calculada a nivel de tenant), la
   * impresora de V1 habría "cubierto" el destino para el tenant entero y V2 -- que en
   * realidad no tiene ninguna impresora de cocina -- no habría aparecido en el aviso. El
   * fix reporta V2, y solo V2 (V1 sigue cubierto y no aparece).
   */
  it("dos locales, solo uno tiene la impresora -> el OTRO local se reporta con el hueco", async () => {
    const tenant = await createTenantFixture(`cov5-${nonce()}`);
    fixtures.push(tenant);
    const { data: v1 } = await admin
      .from("venues")
      .insert({ tenant_id: tenant.tenantId, slug: `v1-${nonce()}`, name: "V1", is_default: true })
      .select("id")
      .single();
    const venue1Id = v1?.id as string;
    const { data: v2 } = await admin
      .from("venues")
      .insert({ tenant_id: tenant.tenantId, slug: `v2-${nonce()}`, name: "V2", is_default: false })
      .select("id")
      .single();
    const venue2Id = v2?.id as string;

    // La carta (tenant-level) usa cocina.
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId,
      slug: `k-${nonce()}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    });

    // Solo V1 tiene impresora de cocina habilitada; V2 no tiene ninguna.
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venue1Id,
      name: "Cocina V1",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
      destination: "cocina",
      enabled: true,
    });

    const gaps = await destinationsMissingPrinter(tenant.tenantId);
    expect(gaps).toEqual([{ venueId: venue2Id, venueName: "V2", destinations: ["cocina"] }]);
    // V1 (cubierto) NO aparece en el resultado.
    expect(gaps.some((g) => g.venueId === venue1Id)).toBe(false);
  });
});

describe("usbPrintersWithoutDevice", () => {
  it("señala una USB habilitada sin device_id", async () => {
    const tenant = await createTenantFixture(`uwd-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "USB huérfana",
      connection: { type: "usb", printerName: "P" },
      destination: "cocina",
      enabled: true, // sin device_id
    });
    const orphans = await usbPrintersWithoutDevice(tenant.tenantId);
    expect(orphans.map((p) => p.name)).toContain("USB huérfana");
  });

  it("no señala una USB con device_id, ni una de red sin device_id", async () => {
    const tenant = await createTenantFixture(`uwd2-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    const { data: device } = await admin
      .from("devices")
      .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "PC" })
      .select("id")
      .single();
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "USB atada",
      device_id: device?.id,
      connection: { type: "usb", printerName: "P" },
      destination: "cocina",
      enabled: true,
    });
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Red sin device",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
      destination: "cocina",
      enabled: true,
    });
    expect(await usbPrintersWithoutDevice(tenant.tenantId)).toEqual([]);
  });
});
