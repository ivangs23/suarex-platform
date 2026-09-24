import { subscribeToOrders } from "@suarex/realtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  signInAs,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * #8 (vía rápida del agente por Realtime): el rol `device` DEBE recibir por Realtime los
 * cambios de `orders` de su tenant, para poder disparar un tick al instante en vez de esperar
 * al poll de 4 s. El aislamiento cross-tenant ya lo cubre `realtime-isolation.test.ts`; aquí lo
 * que se prueba es que la MISMA `subscribeToOrders` que usa `runAgent` entrega eventos cuando
 * quien se suscribe es un device (mismo `orders_select` acotado por `current_tenant_id()`).
 */
let tenant: TenantFixture;
let venueId: string;
let deviceUserId: string;
let unsubscribe: (() => void) | null = null;
const received: { id: string; status: string }[] = [];

// Justo tras `supabase db reset`, Realtime reporta SUBSCRIBED antes de entregar de verdad: el
// calentamiento inserta sondas hasta ver llegar una. Mismo motivo y forma que en
// `realtime-isolation.test.ts`.
const READY_TIMEOUT_MS = 20_000;

async function insertPaidOrder(orderNumber: number): Promise<string> {
  const { data, error } = await admin
    .from("orders")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      order_number: orderNumber,
      status: "paid",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  tenant = await createTenantFixture(`dev-rt-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;

  const device = await signInAs(tenant.tenantId, "device");
  deviceUserId = device.userId;
  unsubscribe = subscribeToOrders(device, tenant.tenantId, (order) => {
    received.push({ id: order.id, status: order.status });
  });

  // Calentamiento: inserta sondas pagadas (una por intento, un id nuevo cada vez) hasta ver
  // llegar cualquiera -- el primer insert tras el join puede caer en la ventana de arranque en
  // frío del consumidor WAL y perderse para siempre.
  const probeIds: string[] = [];
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    probeIds.push(await insertPaidOrder(900 + probeIds.length));
    const attemptDeadline = Math.min(Date.now() + 500, deadline);
    while (Date.now() < attemptDeadline) {
      if (received.some((r) => probeIds.includes(r.id))) {
        ready = true;
        break;
      }
      await waitFor(50);
    }
  }
  await admin.from("orders").delete().in("id", probeIds);
  received.length = 0;
  if (!ready) {
    throw new Error(
      "[PREPARACIÓN] Realtime no entregó ninguna sonda al device tras SUBSCRIBED " +
        "(consumidor WAL sin calentar, típico tras `db reset`). No es un fallo del feature.",
    );
  }
}, READY_TIMEOUT_MS + 15_000);

afterAll(async () => {
  unsubscribe?.();
  if (deviceUserId) await deleteMembershipFixtureUser(deviceUserId);
  if (tenant) await deleteTenantFixture(tenant);
});

describe("Realtime para el device (#8)", () => {
  it("el device recibe por Realtime un pedido pagado de su tenant", async () => {
    const id = await insertPaidOrder(1);
    // Espera acotada a que el evento llegue.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !received.some((r) => r.id === id)) {
      await waitFor(50);
    }

    const evento = received.find((r) => r.id === id);
    expect(evento, "el device no recibió el pedido pagado por Realtime").toBeTruthy();
    expect(evento?.status).toBe("paid");

    await admin.from("orders").delete().eq("id", id);
  });
});
