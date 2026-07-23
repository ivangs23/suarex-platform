import { expect, test } from "@playwright/test";

/**
 * EL ENDPOINT DE CRON NO ESTÁ ABIERTO.
 *
 * `/api/internal/expire-orders` cancela pedidos: nunca debe barrer para quien no traiga el
 * secreto. Este test comprueba justo eso -- que sin credencial válida NO responde 200 y NO
 * barre nada -- sin depender de si `CRON_SECRET` está configurado en el servidor de test:
 *   - con secreto configurado, una petición sin `Authorization` da 401;
 *   - sin secreto configurado, da 503 (falla cerrado).
 * En ambos casos, el barrido queda protegido. El barrido en sí (que cancela los pending
 * caducados) lo cubre `tests/integration/expire-pending-orders.test.ts`.
 */
const BASE = "http://garum.localhost:3000";

test("sin credencial, el endpoint de cron no barre (401 o 503, nunca 200)", async ({ request }) => {
  const sinAuth = await request.post(`${BASE}/api/internal/expire-orders`);
  expect([401, 503]).toContain(sinAuth.status());

  const conTokenFalso = await request.post(`${BASE}/api/internal/expire-orders`, {
    headers: { authorization: "Bearer token-que-no-es" },
  });
  expect([401, 503]).toContain(conTokenFalso.status());
  expect(conTokenFalso.status()).not.toBe(200);
});
