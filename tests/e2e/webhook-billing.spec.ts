import { expect, test } from "@playwright/test";

/**
 * EL WEBHOOK DE FACTURACIÓN NO ACEPTA CUALQUIER COSA.
 *
 * Este endpoint puede SUSPENDER a un restaurante (un evento `customer.subscription.deleted`
 * corta el servicio de inmediato). Si aceptara un cuerpo sin firmar, cualquiera con la URL
 * podría dejar sin carta al cliente que quisiera.
 *
 * El test no depende de si `STRIPE_BILLING_WEBHOOK_SECRET` está configurado en el servidor:
 *   - configurado, un cuerpo sin firma o con firma inválida da 400;
 *   - sin configurar, da 500 ("Sin configurar", falla cerrado).
 * En ningún caso llega a aplicar nada. La lógica que decide qué hacer con un evento válido
 * está cubierta aparte: `apps/web/lib/billing-events.test.ts` (el mapeo de estados) y
 * `tests/integration/billing.test.ts` (`applySubscriptionState` contra base real).
 */
const BASE = "http://garum.localhost:3000";

const EVENTO_FALSO = JSON.stringify({
  id: "evt_falso",
  type: "customer.subscription.deleted",
  data: { object: { id: "sub_falso", status: "canceled", customer: "cus_falso" } },
});

test("un cuerpo sin firma nunca se aplica", async ({ request }) => {
  const res = await request.post(`${BASE}/api/webhook/stripe/billing`, {
    headers: { "content-type": "application/json" },
    data: EVENTO_FALSO,
  });
  expect([400, 500]).toContain(res.status());
  expect(res.status()).not.toBe(200);
});

test("una firma inventada nunca se aplica", async ({ request }) => {
  const res = await request.post(`${BASE}/api/webhook/stripe/billing`, {
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=firma-inventada",
    },
    data: EVENTO_FALSO,
  });
  expect([400, 500]).toContain(res.status());
  expect(res.status()).not.toBe(200);
});

test("el webhook de pagos del comensal es un endpoint DISTINTO", async ({ request }) => {
  // Dos endpoints, dos secretos: un secreto filtrado no debe servir para falsificar los del
  // otro. Si esta ruta desapareciera o se fusionara con la de facturación, esto lo diría.
  const res = await request.post(`${BASE}/api/webhook/stripe`, {
    headers: { "content-type": "application/json" },
    data: EVENTO_FALSO,
  });
  expect([400, 500]).toContain(res.status());
});
