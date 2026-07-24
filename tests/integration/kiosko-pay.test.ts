import { markKioskoOrderPaid, readKioskoOrderForCharge } from "@suarex/db";
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

/**
 * Modo totem, Fase 3: el device marca su pedido kiosko como pagado por la RPC
 * `mark_kiosko_order_paid` (no puede hacer UPDATE directo). Aislamiento: solo su tenant, solo
 * canal kiosko, solo pending. Y `readKioskoOrderForCharge` da el importe de la base.
 */
let tenant: TenantFixture;
let venueId: string;
const userIds: string[] = [];

async function seedDevice() {
  const email = `kio-device-${nonce()}@devices.local`;
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
  await admin
    .from("devices")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Totem", auth_user_id: userId });
  const client = anonClient();
  await client.auth.signInWithPassword({ email, password });
  return client;
}

async function insertOrder(channel: "qr-mesa" | "kiosko", total: number): Promise<string> {
  const { data, error } = await admin
    .from("orders")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      order_number: 1,
      channel,
      total,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  tenant = await createTenantFixture(`kio-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
});
afterAll(async () => {
  for (const id of userIds) await deleteMembershipFixtureUser(id);
  if (tenant) await deleteTenantFixture(tenant);
});

describe("mark_kiosko_order_paid (#totem fase 3)", () => {
  it("el device lee el importe y marca su pedido kiosko como pagado", async () => {
    const client = await seedDevice();
    const orderId = await insertOrder("kiosko", 12.5);

    const forCharge = await readKioskoOrderForCharge(client, orderId);
    expect(forCharge?.amountCents).toBe(1250);
    expect(forCharge?.status).toBe("pending");

    expect(await markKioskoOrderPaid(client, orderId)).toBe(true);

    const { data } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", orderId)
      .single();
    expect(data?.status).toBe("paid");
    expect(data?.paid_at).not.toBeNull();

    // Idempotente: un segundo intento no marca nada (ya no está pending).
    expect(await markKioskoOrderPaid(client, orderId)).toBe(false);
  });

  it("NO marca un pedido de canal qr-mesa (ese paga por Stripe)", async () => {
    const client = await seedDevice();
    const orderId = await insertOrder("qr-mesa", 9);
    expect(await markKioskoOrderPaid(client, orderId)).toBe(false);
    const { data } = await admin.from("orders").select("status").eq("id", orderId).single();
    expect(data?.status).toBe("pending");
  });

  it("un device de OTRO tenant no puede marcar este pedido", async () => {
    const kioskoOrder = await insertOrder("kiosko", 5);
    const otro = await createTenantFixture(`kio-b-${nonce()}`);
    const { data: venueB } = await admin
      .from("venues")
      .insert({ tenant_id: otro.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
      .select("id")
      .single();
    const email = `kio-b-${nonce()}@devices.local`;
    const password = `pw-${nonce()}`;
    const { data: user } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    const userId = user?.user?.id as string;
    await admin
      .from("memberships")
      .insert({ user_id: userId, tenant_id: otro.tenantId, role: "device" });
    await admin.from("devices").insert({
      tenant_id: otro.tenantId,
      venue_id: venueB?.id,
      name: "Totem B",
      auth_user_id: userId,
    });
    const clientB = anonClient();
    await clientB.auth.signInWithPassword({ email, password });

    expect(await markKioskoOrderPaid(clientB, kioskoOrder)).toBe(false);
    const { data } = await admin.from("orders").select("status").eq("id", kioskoOrder).single();
    expect(data?.status).toBe("pending");

    await deleteMembershipFixtureUser(userId);
    await deleteTenantFixture(otro);
  });
});
