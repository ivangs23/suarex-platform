import { expect, test } from "@playwright/test";
import Stripe from "stripe";
import {
  deleteOrder,
  deleteStripeConfig,
  findOrderByPublicToken,
  firstProductIdOfTenant,
  orderStatusForTest,
  setPaymentIntentForTest,
  setStripeConfigForTest,
} from "./helpers/orders-db.js";

/**
 * EL WEBHOOK POR NEGOCIO, con firmas de verdad.
 *
 * Cada negocio cobra en su propia cuenta y cada cuenta firma con SU secreto. Verificar una firma
 * exige saber de antemano cuál usar, y eso no se deduce de un evento sin verificar -- por eso el
 * negocio va en la URL.
 *
 * Aquí no se llama a Stripe: se FIRMAN los eventos localmente con `generateTestHeaderString`, que
 * usa el mismo HMAC que Stripe. Así se puede comprobar de punta a punta lo que de otro modo solo
 * se vería en producción, y que es exactamente lo que da miedo: que un cobro se haga y el pedido
 * no se marque pagado.
 */

const ORIGIN = "http://garum.localhost:3000";
const QR_MESA_1 = `${ORIGIN}/m/11111111-1111-1111-1111-111111111111`;
const SECRETO = "whsec_de_prueba_garum";

/** Un evento firmado como lo firmaría Stripe, sin salir de la máquina. */
function eventoFirmado(paymentIntentId: string, secret = SECRETO) {
  const payload = JSON.stringify({
    id: `evt_${Date.now()}`,
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { id: paymentIntentId, object: "payment_intent" } },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, signature };
}

/** Un pedido pendiente de garum con un PaymentIntent conocido, para poder marcarlo por webhook. */
async function pedidoPendiente(page: import("@playwright/test").Page, intentId: string) {
  await page.goto(QR_MESA_1);
  const productId = await firstProductIdOfTenant("garum");
  const response = await page.request.post(`${ORIGIN}/api/orders`, {
    data: { lines: [{ productId, quantity: 1, extraIds: [], notes: null }] },
  });
  expect(response.ok()).toBeTruthy();
  const { publicToken } = (await response.json()) as { publicToken: string };
  const { orderId } = await findOrderByPublicToken(publicToken);
  await setPaymentIntentForTest(orderId, intentId);
  return orderId;
}

/**
 * Da al negocio sus credenciales DESPUÉS de crear el pedido, no antes.
 *
 * Desde la fase 3 el pedido se cobra con la clave del propio negocio, así que con una clave falsa
 * ni siquiera se puede crear -- Stripe la rechaza. El webhook, en cambio, no llama a Stripe: solo
 * verifica un HMAC, y para eso una clave de mentira sirve igual.
 */
async function conCredenciales() {
  await setStripeConfigForTest("garum", {
    publishableKey: "pk_test_garum",
    secrets: { secretKey: "sk_test_garum", webhookSecret: SECRETO },
  });
}

test.afterEach(async () => {
  await deleteStripeConfig("garum");
});

test("un evento firmado por el negocio marca su pedido pagado", async ({ page }) => {
  const intentId = `pi_ok_${Date.now()}`;
  const orderId = await pedidoPendiente(page, intentId);
  await conCredenciales();
  try {
    const { payload, signature } = eventoFirmado(intentId);
    const response = await page.request.post(`${ORIGIN}/api/webhook/stripe/garum`, {
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      data: payload,
    });

    expect(response.ok()).toBeTruthy();
    // Lo que de verdad importa: el pedido queda pagado y por tanto sale por la impresora.
    expect(await orderStatusForTest(orderId)).toBe("paid");
  } finally {
    await deleteOrder(orderId);
  }
});

test("una firma hecha con OTRO secreto no marca nada", async ({ page }) => {
  /* Es la mitad que hace útil a la otra: si cualquier cuerpo colara, el endpoint sería una forma
     de marcar pedidos como pagados sin haber pagado. */
  const intentId = `pi_mala_${Date.now()}`;
  const orderId = await pedidoPendiente(page, intentId);
  await conCredenciales();
  try {
    const { payload, signature } = eventoFirmado(intentId, "whsec_de_otro_negocio");
    const response = await page.request.post(`${ORIGIN}/api/webhook/stripe/garum`, {
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      data: payload,
    });

    expect(response.status()).toBe(400);
    expect(await orderStatusForTest(orderId)).toBe("pending");
  } finally {
    await deleteOrder(orderId);
  }
});

test("sin cabecera de firma se rechaza", async ({ page }) => {
  await conCredenciales();
  const { payload } = eventoFirmado("pi_sin_firma");
  const response = await page.request.post(`${ORIGIN}/api/webhook/stripe/garum`, {
    headers: { "content-type": "application/json" },
    data: payload,
  });
  expect(response.status()).toBe(400);
});

test("un negocio que no existe se responde igual que una firma inválida", async ({ page }) => {
  await conCredenciales();
  /* Contestar distinto convertiría esto en una forma cómoda de averiguar qué clientes hay dados
     de alta. */
  const { payload, signature } = eventoFirmado("pi_x");
  const response = await page.request.post(`${ORIGIN}/api/webhook/stripe/inventado`, {
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    data: payload,
  });
  expect(response.status()).toBe(400);
});

test("un negocio sin credenciales devuelve 5xx, para que Stripe reintente", async ({ page }) => {
  /* Un 4xx haría que Stripe diera el evento por entregado y lo descartara: el cobro quedaría
     hecho y el pedido sin marcar para siempre. Con 5xx, al terminar de configurar entran solos. */
  const { payload, signature } = eventoFirmado("pi_y");
  const response = await page.request.post(`${ORIGIN}/api/webhook/stripe/garum`, {
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    data: payload,
  });
  expect(response.status()).toBeGreaterThanOrEqual(500);
});
