import { createDeviceClient, runAgentTick } from "@suarex/agent";
import { registerUsbRawSink } from "@suarex/printing";
import { afterEach, describe, expect, it } from "vitest";
import {
  admin,
  anonKeyForTest,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  supabaseUrlForTest,
  type TenantFixture,
} from "./helpers/tenants.js";

type UsbCapture = { buffer: Buffer; printerName: string };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  registerUsbRawSink(null);
  for (const c of cleanups.splice(0)) await c();
});

/** Siembra un tenant con un venue, un pedido pagado de cocina, un device (Auth + membership
 * + fila devices enlazada), y devuelve credenciales + ids. */
async function seed(): Promise<{
  tenant: TenantFixture;
  venueId: string;
  orderId: string;
  deviceId: string;
  email: string;
  password: string;
}> {
  const tenant = await createTenantFixture(`usb-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  const venueId = venue?.id as string;
  const { data: cat } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `k-${nonce()}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    })
    .select("id")
    .single();
  const { data: prod } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: cat?.id,
      name_i18n: { es: "Paella" },
      price: 12,
    })
    .select("id")
    .single();
  const { data: table } = await admin
    .from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: `m-${nonce()}` })
    .select("id")
    .single();
  const { createPendingOrder } = await import("@suarex/db");
  const order = await createPendingOrder({
    tenantId: tenant.tenantId,
    venueId,
    tableId: table?.id as string,
    lines: [{ productId: prod?.id as string, quantity: 1, extraIds: [], notes: null }],
    taxRate: 0.1,
  });
  await admin
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.orderId);

  const email = `usb-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const deviceUserId = user?.user?.id as string;
  await admin
    .from("memberships")
    .insert({ user_id: deviceUserId, tenant_id: tenant.tenantId, role: "device" });
  const { data: device } = await admin
    .from("devices")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Agente",
      auth_user_id: deviceUserId,
      paired_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  cleanups.push(async () => {
    await deleteMembershipFixtureUser(deviceUserId);
    await deleteTenantFixture(tenant);
  });
  return {
    tenant,
    venueId,
    orderId: order.orderId,
    deviceId: device?.id as string,
    email,
    password,
  };
}

describe("runAgentTick — impresoras USB", () => {
  it("imprime la impresora USB atada a SU dispositivo (bytes al sink) y marca el pedido", async () => {
    const s = await seed();
    await admin.from("printers").insert({
      tenant_id: s.tenant.tenantId,
      venue_id: s.venueId,
      device_id: s.deviceId,
      name: "USB Cocina",
      connection: { type: "usb", printerName: "EPSON TM-T20" },
      destination: "cocina",
      enabled: true,
    });

    const captures: UsbCapture[] = [];
    registerUsbRawSink(async (buffer, printerName) => {
      captures.push({ buffer, printerName });
    });

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(),
      anonKey: anonKeyForTest(),
      email: s.email,
      password: s.password,
    });
    const r = await runAgentTick(client);

    expect(r.printed).toBe(1);
    expect(captures).toHaveLength(1);
    expect(captures[0]?.printerName).toBe("EPSON TM-T20");
    expect(captures[0]?.buffer.toString("latin1")).toContain("Paella");
    const { data: row } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", s.orderId)
      .single();
    expect(row?.printed_at).not.toBeNull();
  });

  it("NO imprime una impresora USB atada a OTRO dispositivo", async () => {
    const s = await seed();
    // Un segundo device del mismo tenant, y la USB atada a ESE otro device.
    const { data: otherUser } = await admin.auth.admin.createUser({
      email: `usb-other-${nonce()}@devices.local`,
      password: "pw",
      email_confirm: true,
    });
    const otherUserId = otherUser?.user?.id as string;
    cleanups.push(async () => {
      await deleteMembershipFixtureUser(otherUserId);
    });
    await admin
      .from("memberships")
      .insert({ user_id: otherUserId, tenant_id: s.tenant.tenantId, role: "device" });
    const { data: otherDevice } = await admin
      .from("devices")
      .insert({
        tenant_id: s.tenant.tenantId,
        venue_id: s.venueId,
        name: "Otro",
        auth_user_id: otherUserId,
      })
      .select("id")
      .single();
    await admin.from("printers").insert({
      tenant_id: s.tenant.tenantId,
      venue_id: s.venueId,
      device_id: otherDevice?.id,
      name: "USB del otro",
      connection: { type: "usb", printerName: "OTRA" },
      destination: "cocina",
      enabled: true,
    });

    const captures: UsbCapture[] = [];
    registerUsbRawSink(async (buffer, printerName) => {
      captures.push({ buffer, printerName });
    });

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(),
      anonKey: anonKeyForTest(),
      email: s.email,
      password: s.password,
    });
    const r = await runAgentTick(client);

    expect(captures).toHaveLength(0); // este agente no reclama la USB de otro device
    expect(r.printed).toBe(0);
  });
});
