import {
  destinationsMissingPrinter,
  usbPrintersNotReported,
  usbPrintersWithoutDevice,
} from "@suarex/db";
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

/**
 * IMPRESORA USB CON UN NOMBRE QUE NINGÚN PC VE.
 *
 * El panel ya ofrece un desplegable con lo que los agentes reportan, pero SIGUE habiendo texto
 * libre -- y tiene que haberlo: el desplegable está vacío hasta que el agente late por primera
 * vez. En ese hueco se teclea a mano, y un typo no falla de forma visible: el agente busca un
 * nombre que no existe y el ticket se pierde. Esto lo detecta después.
 */
describe("usbPrintersNotReported", () => {
  async function seedDevice(
    tenant: TenantFixture,
    venueId: string,
    reportadas: string[] | null,
  ): Promise<string> {
    const { data } = await admin
      .from("devices")
      .insert({
        tenant_id: tenant.tenantId,
        venue_id: venueId,
        name: "PC de cocina",
        reported_printers: reportadas,
      })
      .select("id")
      .single();
    return data?.id as string;
  }

  async function seedUsb(
    tenant: TenantFixture,
    venueId: string,
    deviceId: string | null,
    printerName: string,
  ): Promise<void> {
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: `Impresora ${printerName}`,
      connection: { type: "usb", printerName },
      destination: "cocina",
      enabled: true,
      device_id: deviceId,
    });
  }

  it("señala la que su PC no ve", async () => {
    const tenant = await createTenantFixture(`unr-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    const deviceId = await seedDevice(tenant, venueId, ["EPSON TM-T20"]);
    await seedUsb(tenant, venueId, deviceId, "EPSON TM-T2O"); // cero en vez de O

    const avisos = await usbPrintersNotReported(tenant.tenantId);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.printerName).toBe("EPSON TM-T2O");
    expect(avisos[0]?.deviceName, "hay que decir QUÉ PC no la ve").toBe("PC de cocina");
  });

  it("no señala la que sí está en la lista", async () => {
    const tenant = await createTenantFixture(`unr2-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    const deviceId = await seedDevice(tenant, venueId, ["EPSON TM-T20", "Microsoft Print to PDF"]);
    await seedUsb(tenant, venueId, deviceId, "EPSON TM-T20");

    expect(await usbPrintersNotReported(tenant.tenantId)).toHaveLength(0);
  });

  it("una diferencia solo de mayúsculas no es un fallo", async () => {
    // Los nombres de impresora de Windows no distinguen mayúsculas al abrirlas. Avisar de algo
    // que funciona enseña a ignorar los avisos, y entonces también se ignora el que importa.
    const tenant = await createTenantFixture(`unr3-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    const deviceId = await seedDevice(tenant, venueId, ["EPSON TM-T20"]);
    await seedUsb(tenant, venueId, deviceId, "epson tm-t20");

    expect(await usbPrintersNotReported(tenant.tenantId)).toHaveLength(0);
  });

  it("un PC que todavía no ha reportado no acusa a nadie", async () => {
    // Agente recién instalado, o una versión anterior al reporte. Una lista vacía significa "no
    // sé", no "no existe": tratarla como acusación llenaría el panel de avisos falsos justo el
    // día del alta, que es cuando peor sienta.
    const tenant = await createTenantFixture(`unr4-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    const deviceId = await seedDevice(tenant, venueId, null);
    await seedUsb(tenant, venueId, deviceId, "La que sea");

    expect(await usbPrintersNotReported(tenant.tenantId)).toHaveLength(0);
  });

  it("una USB sin dispositivo no se cuenta aquí: ya la cubre el otro aviso", async () => {
    // Dos avisos sobre la misma impresora dirían dos cosas distintas y ninguna accionable.
    const tenant = await createTenantFixture(`unr5-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await seedDevice(tenant, venueId, ["EPSON TM-T20"]);
    await seedUsb(tenant, venueId, null, "Inventada");

    expect(await usbPrintersNotReported(tenant.tenantId)).toHaveLength(0);
    expect(await usbPrintersWithoutDevice(tenant.tenantId)).toHaveLength(1);
  });

  it("una impresora deshabilitada no avisa", async () => {
    const tenant = await createTenantFixture(`unr6-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    const deviceId = await seedDevice(tenant, venueId, ["EPSON TM-T20"]);
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Apagada",
      connection: { type: "usb", printerName: "Inventada" },
      destination: "cocina",
      enabled: false,
      device_id: deviceId,
    });

    expect(await usbPrintersNotReported(tenant.tenantId)).toHaveLength(0);
  });

  it("una impresora de RED no se compara con nada", async () => {
    const tenant = await createTenantFixture(`unr7-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    const deviceId = await seedDevice(tenant, venueId, ["EPSON TM-T20"]);
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "De red",
      connection: { type: "network", host: "10.0.0.5", port: 9100 },
      destination: "cocina",
      enabled: true,
      device_id: deviceId,
    });

    expect(await usbPrintersNotReported(tenant.tenantId)).toHaveLength(0);
  });
});
