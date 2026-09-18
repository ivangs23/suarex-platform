import { expect, test } from "@playwright/test";

/**
 * EL BARRIDO DE IMPAGOS NO ESTÁ ABIERTO.
 *
 * `/api/internal/suspend-overdue` SUSPENDE clientes: es el endpoint más peligroso de la
 * plataforma, porque una sola llamada puede dejar sin carta a todos los restaurantes con la
 * ventana de gracia vencida. Nunca debe responder 200 a quien no traiga el secreto.
 *
 * Igual que `cron-expire.spec.ts`, no depende de si `CRON_SECRET` está configurado en el
 * servidor de test:
 *   - con secreto configurado, una petición sin `Authorization` da 401;
 *   - sin secreto configurado, da 503 (falla cerrado, no barre nada).
 * En ambos casos el barrido queda protegido. El barrido en sí lo cubre
 * `tests/integration/billing.test.ts` (`suspendExpiredGrace`).
 */
const BASE = "http://garum.localhost:3000";

test("sin credencial, el barrido de impagos no suspende a nadie (401 o 503, nunca 200)", async ({
  request,
}) => {
  const sinAuth = await request.post(`${BASE}/api/internal/suspend-overdue`);
  expect([401, 503]).toContain(sinAuth.status());

  const conTokenFalso = await request.post(`${BASE}/api/internal/suspend-overdue`, {
    headers: { authorization: "Bearer token-que-no-es" },
  });
  expect([401, 503]).toContain(conTokenFalso.status());
  expect(conTokenFalso.status()).not.toBe(200);
});

test("la purga de datos personales tampoco está abierta", async ({ request }) => {
  // Mismo criterio: borra datos de forma irreversible.
  const sinAuth = await request.post(`${BASE}/api/internal/purge-orders`);
  expect([401, 503]).toContain(sinAuth.status());
  expect(sinAuth.status()).not.toBe(200);
});
