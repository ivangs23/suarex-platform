import {
  createPendingOrder,
  markOrderPaid,
  purgeStripeEvents,
  recordStripeEvent,
  stripeEventYaProcesado,
} from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * El lado de la base de los webhooks de Stripe: que un cobro que no es el total del pedido no lo
 * da por pagado, y el registro de eventos ya procesados. Lo que hace la ruta con ellos (orden,
 * firma, duplicados) lo prueba `apps/web/app/api/webhook/stripe/webhook.test.ts`.
 */

let tenant: TenantFixture;
let venueId: string;
let productId: string;

beforeAll(async () => {
  tenant = await createTenantFixture(`whk-${nonce()}`);
  const seed = await seedCatalog(tenant.tenantId, "whk");
  venueId = seed.venueId;
  productId = seed.productId;
});

afterAll(async () => {
  if (tenant) await deleteTenantFixture(tenant);
});

/** Un pedido `pending` con su PaymentIntent, como lo deja `/api/orders`. */
async function pedidoConCobro() {
  const order = await createPendingOrder({
    tenantId: tenant.tenantId,
    venueId,
    tableId: null,
    lines: [{ productId, quantity: 2, extraIds: [], notes: null }],
    taxRate: 0.1,
  });
  const pi = `pi_whk_${nonce()}`;
  await admin.from("orders").update({ stripe_payment_intent_id: pi }).eq("id", order.orderId);
  const estado = async () =>
    (await admin.from("orders").select("status").eq("id", order.orderId).single()).data?.status;
  return { order, pi, estado };
}

describe("markOrderPaid", () => {
  it("distingue un PaymentIntent que no corresponde a ningún pedido", async () => {
    // No es un caso benigno: significa que se cobró algo de lo que este sistema
    // no tiene registro, o que el webhook apunta al entorno equivocado.
    expect(await markOrderPaid(`pi_desconocido_${nonce()}`, 1000, "eur")).toBe("order-not-found");
  });

  it("un cobro de otro importe NO da el pedido por pagado", async () => {
    const { order, pi, estado } = await pedidoConCobro();
    expect(await markOrderPaid(pi, order.totalCents - 1, "eur")).toBe("amount-mismatch");
    expect(await estado()).toBe("pending");
  });

  it("ni uno en otra moneda, aunque la cifra coincida", async () => {
    const { order, pi, estado } = await pedidoConCobro();
    expect(await markOrderPaid(pi, order.totalCents, "usd")).toBe("amount-mismatch");
    expect(await estado()).toBe("pending");
  });

  it("el importe exacto, con la moneda en minúsculas como la manda Stripe, lo marca", async () => {
    const { order, pi, estado } = await pedidoConCobro();
    expect(await markOrderPaid(pi, order.totalCents, "eur")).toBe("marked");
    expect(await estado()).toBe("paid");
  });
});

describe("eventos de Stripe procesados", () => {
  it("un evento se registra una vez; el segundo registro es un duplicado", async () => {
    const event = { id: `evt_${nonce()}`, type: "payment_intent.succeeded" };
    expect(await stripeEventYaProcesado(event.id)).toBe(false);
    expect(await recordStripeEvent(event, tenant.tenantId)).toBe("new");
    expect(await stripeEventYaProcesado(event.id)).toBe(true);
    expect(await recordStripeEvent(event, tenant.tenantId)).toBe("duplicate");
  });

  it("la ruta del entorno registra sin negocio", async () => {
    const event = { id: `evt_${nonce()}`, type: "charge.refunded" };
    expect(await recordStripeEvent(event, null)).toBe("new");
    const { data } = await admin.from("stripe_events").select("tenant_id").eq("id", event.id);
    expect(data).toEqual([{ tenant_id: null }]);
    await admin.from("stripe_events").delete().eq("id", event.id);
  });

  it("la retención borra los de más de 90 días y deja los recientes", async () => {
    const viejo = `evt_viejo_${nonce()}`;
    const reciente = `evt_reciente_${nonce()}`;
    const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();
    await admin.from("stripe_events").insert([
      { id: viejo, tenant_id: tenant.tenantId, type: "x", received_at: hace(91) },
      { id: reciente, tenant_id: tenant.tenantId, type: "x", received_at: hace(89) },
    ]);

    expect(await purgeStripeEvents(90)).toBeGreaterThanOrEqual(1);

    const { data } = await admin.from("stripe_events").select("id").in("id", [viejo, reciente]);
    expect(data?.map((e) => e.id)).toEqual([reciente]);
  });
});
