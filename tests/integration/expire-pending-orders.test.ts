import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenant: TenantFixture;
let venueId: string;

afterAll(async () => {
  if (tenant) await deleteTenantFixture(tenant);
});

beforeAll(async () => {
  tenant = await createTenantFixture(`expire-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
});

/** Inserta un pedido con `created_at` explícito, para poder simular "abandonado hace rato". */
async function insertOrderAt(
  tenantId: string,
  venueId: string,
  status: string,
  orderNumber: number,
  createdAt: Date,
): Promise<string> {
  const { data, error } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      venue_id: venueId,
      order_number: orderNumber,
      status,
      created_at: createdAt.toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

describe("expire_pending_orders", () => {
  it("marca cancelled un pending que superó el plazo, deja intacto un pending reciente, y NUNCA toca un paid ni aunque sea viejo", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const staleId = await insertOrderAt(tenant.tenantId, venueId, "pending", 501, oneHourAgo);
    const freshId = await insertOrderAt(tenant.tenantId, venueId, "pending", 502, new Date());
    const oldPaidId = await insertOrderAt(tenant.tenantId, venueId, "paid", 503, oneHourAgo);
    const oldServedId = await insertOrderAt(tenant.tenantId, venueId, "served", 504, oneHourAgo);
    const oldCancelledId = await insertOrderAt(
      tenant.tenantId,
      venueId,
      "cancelled",
      505,
      oneHourAgo,
    );

    const { data: expiredIds, error } = await admin.rpc("expire_pending_orders", {
      p_timeout_minutes: 30,
    });
    if (error) throw error;

    const expiredSet = new Set((expiredIds as string[] | null) ?? []);

    // El pending viejo SÍ se marca cancelled...
    expect(expiredSet.has(staleId)).toBe(true);
    // ...el reciente NO se toca (todavía no ha superado el plazo)...
    expect(expiredSet.has(freshId)).toBe(false);
    // ...y ningún estado distinto de pending se toca jamás, por viejo que sea.
    expect(expiredSet.has(oldPaidId)).toBe(false);
    expect(expiredSet.has(oldServedId)).toBe(false);
    expect(expiredSet.has(oldCancelledId)).toBe(false);

    const { data: rows } = await admin
      .from("orders")
      .select("id, status")
      .in("id", [staleId, freshId, oldPaidId, oldServedId, oldCancelledId]);
    const statusById = new Map((rows ?? []).map((r) => [r.id as string, r.status as string]));

    expect(statusById.get(staleId)).toBe("cancelled");
    expect(statusById.get(freshId)).toBe("pending");
    expect(statusById.get(oldPaidId)).toBe("paid");
    expect(statusById.get(oldServedId)).toBe("served");
    expect(statusById.get(oldCancelledId)).toBe("cancelled");
  });

  it("no pelea con orders_auto_serve: un pending expirado con ambas estaciones resueltas termina cancelled, no served", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const orderId = await insertOrderAt(tenant.tenantId, venueId, "pending", 601, oneHourAgo);

    // Ambas estaciones ya resueltas (simulando que el personal preparó por
    // adelantado), pero el pedido nunca se pagó.
    await admin
      .from("orders")
      .update({ kitchen_status: "done", bar_status: "na" })
      .eq("id", orderId);

    const { error } = await admin.rpc("expire_pending_orders", { p_timeout_minutes: 30 });
    if (error) throw error;

    const { data } = await admin.from("orders").select("status").eq("id", orderId).single();
    // El trigger orders_auto_serve solo actúa sobre new.status in ('paid','preparing');
    // aquí new.status = 'cancelled', así que no dispara y el pedido no se "autosirve".
    expect(data?.status).toBe("cancelled");
  });
});
