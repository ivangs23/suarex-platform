import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las dos rutas de webhook de pagos, con eventos firmados de verdad y la base simulada. Fija el
 * orden acordado: comprobar si el evento ya se procesó, procesarlo, y registrarlo SOLO si todo fue
 * bien -- registrarlo antes haría que el reintento de un fallo se descartara como duplicado.
 */
const SECRETO = "whsec_test_secreto";

const db = vi.hoisted(() => ({
  findTenantBySlug: vi.fn(),
  getStripeCredentials: vi.fn(),
  markOrderDisputed: vi.fn(),
  markOrderPaid: vi.fn(),
  markOrderRefunded: vi.fn(),
  recordStripeEvent: vi.fn(),
  stripeEventYaProcesado: vi.fn(),
}));
const log = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));

vi.mock("@suarex/db", () => db);
vi.mock("@/lib/log", () => ({ log }));
vi.mock("@/lib/stripe", () => ({
  stripeEnvCredentials: () => ({ secretKey: "sk_test_x", webhookSecret: SECRETO }),
  stripeClientWithKey: (clave: string) => new Stripe(clave),
}));

const entorno = await import("./route");
const porNegocio = await import("./[slug]/route");

function eventoFirmado(evento: { id: string; type: string; data: { object: unknown } }) {
  const payload = JSON.stringify({ object: "event", ...evento });
  const firma = new Stripe("sk_test_x").webhooks.generateTestHeaderString({
    payload,
    secret: SECRETO,
  });
  return new Request("http://localhost/api/webhook/stripe", {
    method: "POST",
    headers: { "stripe-signature": firma },
    body: payload,
  });
}

const cobro = (id = "evt_1") => ({
  id,
  type: "payment_intent.succeeded",
  data: {
    object: { id: "pi_1", object: "payment_intent", amount_received: 3600, currency: "eur" },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.stripeEventYaProcesado.mockResolvedValue(false);
  db.recordStripeEvent.mockResolvedValue("new");
  db.markOrderPaid.mockResolvedValue("marked");
});

describe("POST /api/webhook/stripe (entorno)", () => {
  it("procesa el cobro con lo cobrado de verdad y SOLO después registra el evento", async () => {
    const respuesta = await entorno.POST(eventoFirmado(cobro()));

    expect(respuesta.status).toBe(200);
    expect(db.markOrderPaid).toHaveBeenCalledWith("pi_1", 3600, "eur");
    expect(db.recordStripeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt_1" }),
      null,
    );
    expect(db.markOrderPaid.mock.invocationCallOrder[0]).toBeLessThan(
      db.recordStripeEvent.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("una reentrega de un evento ya procesado no vuelve a tocar el pedido", async () => {
    db.stripeEventYaProcesado.mockResolvedValue(true);

    const respuesta = await entorno.POST(eventoFirmado(cobro()));

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ received: true, duplicate: true });
    expect(db.markOrderPaid).not.toHaveBeenCalled();
    expect(db.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("si el proceso falla, el evento NO queda registrado: el reintento de Stripe lo procesará", async () => {
    db.markOrderPaid.mockRejectedValue(new Error("Postgres caído"));

    await expect(entorno.POST(eventoFirmado(cobro()))).rejects.toThrow("Postgres caído");
    expect(db.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("un importe que no cuadra se avisa y responde 200 (Stripe no debe reintentar)", async () => {
    db.markOrderPaid.mockResolvedValue("amount-mismatch");

    const respuesta = await entorno.POST(eventoFirmado(cobro()));

    expect(respuesta.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      "stripe.importe_no_coincide",
      expect.objectContaining({ paymentIntentId: "pi_1", amountReceived: 3600, currency: "eur" }),
    );
    expect(db.recordStripeEvent).toHaveBeenCalledOnce();
  });

  it("una firma que no cuadra no toca nada", async () => {
    const respuesta = await entorno.POST(
      new Request("http://localhost/api/webhook/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=falsa" },
        body: JSON.stringify(cobro()),
      }),
    );

    expect(respuesta.status).toBe(400);
    for (const fn of Object.values(db)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhook/stripe/[slug] (por negocio)", () => {
  const params = Promise.resolve({ slug: "garum" });

  beforeEach(() => {
    db.findTenantBySlug.mockResolvedValue({ id: "t-garum" });
    db.getStripeCredentials.mockResolvedValue({ secretKey: "sk_test_x", webhookSecret: SECRETO });
  });

  it("acota el cobro al negocio y registra el evento con su tenant", async () => {
    const respuesta = await porNegocio.POST(eventoFirmado(cobro("evt_2")), { params });

    expect(respuesta.status).toBe(200);
    expect(db.markOrderPaid).toHaveBeenCalledWith("pi_1", 3600, "eur", "t-garum");
    expect(db.recordStripeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt_2" }),
      "t-garum",
    );
  });

  it("una reentrega no vuelve a tocar el pedido", async () => {
    db.stripeEventYaProcesado.mockResolvedValue(true);

    const respuesta = await porNegocio.POST(eventoFirmado(cobro("evt_2")), { params });

    expect(respuesta.status).toBe(200);
    expect(db.markOrderPaid).not.toHaveBeenCalled();
    expect(db.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("un importe que no cuadra se avisa con el negocio", async () => {
    db.markOrderPaid.mockResolvedValue("amount-mismatch");

    const respuesta = await porNegocio.POST(eventoFirmado(cobro("evt_3")), { params });

    expect(respuesta.status).toBe(200);
    expect(log.error).toHaveBeenCalledWith(
      "stripe.importe_no_coincide",
      expect.objectContaining({ tenantId: "t-garum", paymentIntentId: "pi_1" }),
    );
  });
});
