import { buildUsbConnection, createPrinter, listPrinters } from "@suarex/db";
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

async function seedVenueAndDevice(
  tenant: TenantFixture,
): Promise<{ venueId: string; deviceId: string }> {
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  const venueId = venue?.id as string;
  const { data: device } = await admin
    .from("devices")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "PC" })
    .select("id")
    .single();
  return { venueId, deviceId: device?.id as string };
}

describe("buildUsbConnection", () => {
  it("construye una conexión USB válida", () => {
    expect(buildUsbConnection("EPSON TM-T20")).toEqual({
      type: "usb",
      printerName: "EPSON TM-T20",
    });
  });
  it("rechaza un printerName vacío", () => {
    expect(() => buildUsbConnection("   ")).toThrow(/printerName|vac/i);
  });
});

describe("createPrinter con conexión USB", () => {
  it("escribe una fila con connection {type:usb, printerName} y su device_id", async () => {
    const tenant = await createTenantFixture(`ap-usb-${nonce()}`);
    fixtures.push(tenant);
    const { venueId, deviceId } = await seedVenueAndDevice(tenant);

    const { id } = await createPrinter(tenant.tenantId, {
      venueId,
      name: "USB Cocina",
      connection: { type: "usb", printerName: "EPSON TM-T20" },
      destination: "cocina",
      deviceId,
    });

    const printers = await listPrinters(tenant.tenantId);
    const row = printers.find((p) => p.id === id);
    expect(row?.connection).toEqual({ type: "usb", printerName: "EPSON TM-T20" });
    expect(row?.deviceId).toBe(deviceId);
  });

  it("sigue escribiendo una conexión de red cuando el tipo es network", async () => {
    const tenant = await createTenantFixture(`ap-net-${nonce()}`);
    fixtures.push(tenant);
    const { venueId } = await seedVenueAndDevice(tenant);
    const { id } = await createPrinter(tenant.tenantId, {
      venueId,
      name: "Red",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
      destination: "cocina",
    });
    const row = (await listPrinters(tenant.tenantId)).find((p) => p.id === id);
    expect(row?.connection).toEqual({ type: "network", host: "127.0.0.1", port: 9100 });
  });

  it("atar una impresora USB a un device de OTRO tenant lo rechaza el trigger", async () => {
    const a = await createTenantFixture(`ap-a-${nonce()}`);
    const b = await createTenantFixture(`ap-b-${nonce()}`);
    fixtures.push(a, b);
    const va = await seedVenueAndDevice(a);
    const vb = await seedVenueAndDevice(b);
    await expect(
      createPrinter(a.tenantId, {
        venueId: va.venueId,
        name: "X",
        connection: { type: "usb", printerName: "P" },
        destination: "cocina",
        deviceId: vb.deviceId, // device del tenant B
      }),
    ).rejects.toThrow(/cross-tenant/i);
  });
});
