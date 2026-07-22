import {
  createDevice,
  createPrinter,
  deletePrinter,
  listPrinters,
  updatePrinter,
} from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin as adminClient,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let venueA: string;
let venueB: string;
let deviceA: string;
let deviceB: string;

beforeAll(async () => {
  tenantA = await createTenantFixture(`admin-printers-a-${nonce()}`);
  tenantB = await createTenantFixture(`admin-printers-b-${nonce()}`);
  venueA = (await seedCatalog(tenantA.tenantId, "a")).venueId;
  venueB = (await seedCatalog(tenantB.tenantId, "b")).venueId;

  deviceA = (await createDevice(tenantA.tenantId, { venueId: venueA, name: "Agente A" })).id;
  deviceB = (await createDevice(tenantB.tenantId, { venueId: venueB, name: "Agente B" })).id;
});

afterAll(async () => {
  for (const fixture of [tenantA, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

describe("createPrinter + listPrinters", () => {
  it("guarda connection = { type: 'network', host, port } y destination, listPrinters la devuelve", async () => {
    const { id } = await createPrinter(tenantA.tenantId, {
      venueId: venueA,
      name: `Impresora-${nonce()}`,
      connection: { type: "network", host: "192.168.1.50", port: 9100 },
      destination: "barra",
    });

    const printers = await listPrinters(tenantA.tenantId);
    const printer = printers.find((p) => p.id === id);
    expect(printer).toBeDefined();
    expect(printer?.tenantId).toBe(tenantA.tenantId);
    expect(printer?.venueId).toBe(venueA);
    expect(printer?.destination).toBe("barra");
    expect(printer?.connection).toEqual({ type: "network", host: "192.168.1.50", port: 9100 });
    expect(printer?.isDefault).toBe(false);
    expect(printer?.enabled).toBe(true);
    expect(printer?.deviceId).toBeNull();
  });

  it("destination por defecto es 'cocina' cuando no se indica", async () => {
    const { id } = await createPrinter(tenantA.tenantId, {
      venueId: venueA,
      name: `Impresora-def-${nonce()}`,
      connection: { type: "network", host: "192.168.1.51", port: 9100 },
    });

    const printers = await listPrinters(tenantA.tenantId);
    expect(printers.find((p) => p.id === id)?.destination).toBe("cocina");
  });

  it("acepta un deviceId del mismo tenant", async () => {
    const { id } = await createPrinter(tenantA.tenantId, {
      venueId: venueA,
      name: `Impresora-dev-${nonce()}`,
      connection: { type: "network", host: "192.168.1.52", port: 9100 },
      deviceId: deviceA,
    });

    const printers = await listPrinters(tenantA.tenantId);
    expect(printers.find((p) => p.id === id)?.deviceId).toBe(deviceA);
  });
});

describe("validación de host/port en el repositorio", () => {
  it("un host vacío es rechazado", async () => {
    await expect(
      createPrinter(tenantA.tenantId, {
        venueId: venueA,
        name: "Sin host",
        connection: { type: "network", host: "   ", port: 9100 },
      }),
    ).rejects.toThrow(/host inválido/);
  });

  it("un port no entero (NaN) es rechazado", async () => {
    await expect(
      createPrinter(tenantA.tenantId, {
        venueId: venueA,
        name: "Port NaN",
        connection: { type: "network", host: "192.168.1.60", port: Number("abc") },
      }),
    ).rejects.toThrow(/port inválido/);
  });

  it("un port de 0 es rechazado", async () => {
    await expect(
      createPrinter(tenantA.tenantId, {
        venueId: venueA,
        name: "Port 0",
        connection: { type: "network", host: "192.168.1.61", port: 0 },
      }),
    ).rejects.toThrow(/port inválido/);
  });

  it("un port negativo (-1) es rechazado", async () => {
    await expect(
      createPrinter(tenantA.tenantId, {
        venueId: venueA,
        name: "Port negativo",
        connection: { type: "network", host: "192.168.1.62", port: -1 },
      }),
    ).rejects.toThrow(/port inválido/);
  });

  it("un port por encima de 65535 (70000) es rechazado", async () => {
    await expect(
      createPrinter(tenantA.tenantId, {
        venueId: venueA,
        name: "Port fuera de rango",
        connection: { type: "network", host: "192.168.1.63", port: 70000 },
      }),
    ).rejects.toThrow(/port inválido/);
  });

  it("un port decimal (9100.5) es rechazado", async () => {
    await expect(
      createPrinter(tenantA.tenantId, {
        venueId: venueA,
        name: "Port decimal",
        connection: { type: "network", host: "192.168.1.64", port: 9100.5 },
      }),
    ).rejects.toThrow(/port inválido/);
  });

  it("los límites del rango (1 y 65535) sí se aceptan", async () => {
    const low = await createPrinter(tenantA.tenantId, {
      venueId: venueA,
      name: `Port-min-${nonce()}`,
      connection: { type: "network", host: "192.168.1.65", port: 1 },
    });
    const high = await createPrinter(tenantA.tenantId, {
      venueId: venueA,
      name: `Port-max-${nonce()}`,
      connection: { type: "network", host: "192.168.1.66", port: 65535 },
    });
    const printers = await listPrinters(tenantA.tenantId);
    const lowConnection = printers.find((p) => p.id === low.id)?.connection;
    const highConnection = printers.find((p) => p.id === high.id)?.connection;
    expect(lowConnection?.type === "network" ? lowConnection.port : undefined).toBe(1);
    expect(highConnection?.type === "network" ? highConnection.port : undefined).toBe(65535);
  });
});

describe("aislamiento entre tenants", () => {
  it("createPrinter con un venueId de otro tenant es rechazado (trigger assert_same_tenant)", async () => {
    await expect(
      createPrinter(tenantA.tenantId, {
        venueId: venueB,
        name: `Intruso-${nonce()}`,
        connection: { type: "network", host: "192.168.1.70", port: 9100 },
      }),
    ).rejects.toThrow(/cross-tenant/i);
  });

  it("createPrinter con un deviceId de otro tenant es rechazado (trigger assert_same_tenant)", async () => {
    await expect(
      createPrinter(tenantA.tenantId, {
        venueId: venueA,
        name: `Intruso-device-${nonce()}`,
        connection: { type: "network", host: "192.168.1.71", port: 9100 },
        deviceId: deviceB,
      }),
    ).rejects.toThrow(/cross-tenant/i);
  });

  it("updatePrinter con el id de otro tenant no afecta ninguna fila y B queda intacta", async () => {
    const name = `cross-upd-${nonce()}`;
    const { id } = await createPrinter(tenantB.tenantId, {
      venueId: venueB,
      name,
      connection: { type: "network", host: "192.168.1.80", port: 9100 },
    });

    await updatePrinter(tenantA.tenantId, id, { name: "Hackeada por A" });

    const { data: rowB } = await adminClient.from("printers").select("name").eq("id", id).single();
    expect(rowB?.name).toBe(name);
  });

  it("deletePrinter con el id de otro tenant no borra la fila de B", async () => {
    const name = `cross-del-${nonce()}`;
    const { id } = await createPrinter(tenantB.tenantId, {
      venueId: venueB,
      name,
      connection: { type: "network", host: "192.168.1.81", port: 9100 },
    });

    await deletePrinter(tenantA.tenantId, id);

    const { data: rowB } = await adminClient
      .from("printers")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(rowB?.id).toBe(id);
  });
});

describe("update/delete de impresoras", () => {
  it("updatePrinter cambia host+port juntos, destination y enabled; deletePrinter borra la fila", async () => {
    const { id } = await createPrinter(tenantA.tenantId, {
      venueId: venueA,
      name: `upd-${nonce()}`,
      connection: { type: "network", host: "192.168.1.90", port: 9100 },
    });

    await updatePrinter(tenantA.tenantId, id, {
      connection: { type: "network", host: "192.168.1.99", port: 9101 },
      destination: "all",
      enabled: false,
      isDefault: true,
    });
    let printers = await listPrinters(tenantA.tenantId);
    const printer = printers.find((p) => p.id === id);
    expect(printer?.connection).toEqual({ type: "network", host: "192.168.1.99", port: 9101 });
    expect(printer?.destination).toBe("all");
    expect(printer?.enabled).toBe(false);
    expect(printer?.isDefault).toBe(true);

    await deletePrinter(tenantA.tenantId, id);
    printers = await listPrinters(tenantA.tenantId);
    expect(printers.some((p) => p.id === id)).toBe(false);
  });

  it("updatePrinter valida host/port igual que createPrinter", async () => {
    const { id } = await createPrinter(tenantA.tenantId, {
      venueId: venueA,
      name: `upd-invalid-${nonce()}`,
      connection: { type: "network", host: "192.168.1.93", port: 9100 },
    });

    await expect(
      updatePrinter(tenantA.tenantId, id, {
        connection: { type: "network", host: "192.168.1.94", port: 70000 },
      }),
    ).rejects.toThrow(/port inválido/);
    await expect(
      updatePrinter(tenantA.tenantId, id, {
        connection: { type: "network", host: "  ", port: 9100 },
      }),
    ).rejects.toThrow(/host inválido/);
  });
});
