import { probeNetworkPrinters } from "@suarex/agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakePrinter } from "../helpers/fake-escpos-server.js";
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
 * #12: el desktop sondea la conexión de las impresoras de RED del tenant con el cliente del
 * agente. Aquí se prueba `probeNetworkPrinters` end-to-end: lee las impresoras de red con el JWT
 * del device y sondea cada host:port. Una que responde -> `ok`; una que apunta a un puerto muerto
 * -> `ok:false` con motivo.
 */
let tenant: TenantFixture;
let venueId: string;
let deviceClient: SignedInClient;
const userIds: string[] = [];

async function createNetworkPrinter(name: string, host: string, port: number): Promise<void> {
  const { error } = await admin.from("printers").insert({
    tenant_id: tenant.tenantId,
    venue_id: venueId,
    name,
    connection: { type: "network", host, port },
    destination: "cocina",
    enabled: true,
  });
  if (error) throw error;
}

beforeAll(async () => {
  tenant = await createTenantFixture(`netprobe-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;

  deviceClient = await signInAs(tenant.tenantId, "device");
  userIds.push(deviceClient.userId);
});

afterAll(async () => {
  for (const id of userIds) await deleteMembershipFixtureUser(id);
  if (tenant) await deleteTenantFixture(tenant);
});

describe("probeNetworkPrinters (#12)", () => {
  it("marca `ok` la que responde y `ok:false` la que no", async () => {
    const printer = await startFakePrinter();
    const alcanzablePort = printer.port;

    // Una que responde (fake server vivo) y otra que apunta a un puerto ya cerrado.
    const muerta = await startFakePrinter();
    const muertaPort = muerta.port;
    await muerta.close();

    await createNetworkPrinter("Cocina viva", "127.0.0.1", alcanzablePort);
    await createNetworkPrinter("Cocina muerta", "127.0.0.1", muertaPort);

    try {
      const probes = await probeNetworkPrinters(deviceClient);
      expect(probes).toHaveLength(2);

      const viva = probes.find((p) => p.label === "Cocina viva");
      expect(viva?.ok).toBe(true);
      expect(viva?.host).toBe("127.0.0.1");
      expect(viva?.port).toBe(alcanzablePort);

      const cocinaMuerta = probes.find((p) => p.label === "Cocina muerta");
      expect(cocinaMuerta?.ok).toBe(false);
      expect(cocinaMuerta?.reason).toBeTruthy();
    } finally {
      await printer.close();
    }
  });
});
