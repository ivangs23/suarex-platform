import { listDevices } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anonClient,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenant: TenantFixture;
const userIds: string[] = [];

beforeAll(async () => {
  tenant = await createTenantFixture(`hb-${nonce()}`);
});
afterAll(async () => {
  for (const id of userIds) await deleteMembershipFixtureUser(id);
  if (tenant) await deleteTenantFixture(tenant);
});

// Crea un device (cuenta Auth + membership device + fila devices enlazada) y devuelve un
// cliente autenticado como ese device.
async function seedDeviceClient(venueId: string) {
  const email = `hb-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const userId = user?.user?.id as string;
  userIds.push(userId);
  await admin
    .from("memberships")
    .insert({ user_id: userId, tenant_id: tenant.tenantId, role: "device" });
  const { data: device } = await admin
    .from("devices")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Agente", auth_user_id: userId })
    .select("id")
    .single();
  const client = anonClient();
  await client.auth.signInWithPassword({ email, password });
  return { client, userId, deviceId: device?.id as string };
}

describe("device_heartbeat", () => {
  it("actualiza last_seen_at y app_version SOLO de la fila propia del device", async () => {
    const { data: venue } = await admin
      .from("venues")
      .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
      .select("id")
      .single();
    const venueId = venue?.id as string;

    const a = await seedDeviceClient(venueId);
    const b = await seedDeviceClient(venueId);

    const { error } = await a.client.rpc("device_heartbeat", { p_app_version: "1.2.3" });
    expect(error).toBeNull();

    const { data: rowA } = await admin
      .from("devices")
      .select("last_seen_at, app_version")
      .eq("id", a.deviceId)
      .single();
    expect(rowA?.app_version).toBe("1.2.3");
    expect(rowA?.last_seen_at).not.toBeNull();

    // La fila del OTRO device no se tocó.
    const { data: rowB } = await admin
      .from("devices")
      .select("last_seen_at, app_version")
      .eq("id", b.deviceId)
      .single();
    expect(rowB?.app_version).toBeNull();
    expect(rowB?.last_seen_at).toBeNull();
  });

  it("reporta las impresoras del SO en `printers`, y omitirlas no las borra (#7)", async () => {
    const { data: venue } = await admin
      .from("venues")
      .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: false })
      .select("id")
      .single();
    const venueId = venue?.id as string;

    const d = await seedDeviceClient(venueId);

    // Primer heartbeat con lista: se guarda tal cual.
    const nombres = ["EPSON TM-T20", "Star TSP143"];
    const { error: e1 } = await d.client.rpc("device_heartbeat", {
      p_app_version: "1.0.0",
      p_printers: nombres,
    });
    expect(e1).toBeNull();

    const { data: row1 } = await admin
      .from("devices")
      .select("printers")
      .eq("id", d.deviceId)
      .single();
    expect(row1?.printers).toEqual(nombres);

    // Segundo heartbeat SIN lista (p. ej. fuera de Electron): `coalesce` conserva las anteriores.
    const { error: e2 } = await d.client.rpc("device_heartbeat", { p_app_version: "1.0.1" });
    expect(e2).toBeNull();

    const { data: row2 } = await admin
      .from("devices")
      .select("printers, app_version")
      .eq("id", d.deviceId)
      .single();
    expect(row2?.printers).toEqual(nombres);
    expect(row2?.app_version).toBe("1.0.1");

    // `listDevices` (lo que consume el panel admin) las expone.
    const devices = await listDevices(tenant.tenantId);
    const reportado = devices.find((dev) => dev.id === d.deviceId);
    expect(reportado?.printers).toEqual(nombres);
  });
});
