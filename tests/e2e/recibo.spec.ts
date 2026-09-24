import { expect, test } from "@playwright/test";
import {
  clearAllRateLimits,
  deleteOrder,
  findOrderByPublicToken,
  firstProductIdOfTenant,
} from "./helpers/orders-db.js";

/**
 * EL RECIBO QUE VE EL COMENSAL EN PANTALLA.
 *
 * Por qué hace falta un fichero nuevo y no una línea en `pago.spec.ts`: ningún e2e de esta
 * suite llegaba a `/pedido/{publicToken}` -- `pago.spec.ts` no teclea la tarjeta a propósito
 * (vive en un iframe cross-origin de Stripe) y `pedido-status-api.spec.ts` solo golpea la API.
 * La pantalla del recibo no tenía cobertura de navegador ninguna.
 *
 * Lo que se protege aquí es la decisión D1 del spec de la Fase 1: SuarEx NO emite facturas, y
 * el aviso que lo dice tiene que verse SIN descargar nada. Un test que solo mirase el PDF
 * dejaría pasar el caso real -- el comensal que mira la pantalla y se va.
 *
 * El pedido se crea de verdad (`POST /api/orders`) y se borra en un `finally`, pase lo que
 * pase: mismo patrón que `pedido-status-api.spec.ts` y `staff-board.spec.ts`.
 */

const GARUM_TABLE_TOKEN = "11111111-1111-1111-1111-111111111111";
const BASE = "http://garum.localhost:3000";

test.beforeEach(async () => {
  await clearAllRateLimits();
});

test("el recibo avisa en pantalla de que no es una factura, sin descargar nada", async ({
  page,
}) => {
  const productId = await firstProductIdOfTenant("garum");

  // Escanear el QR desde la PÁGINA (no desde el contexto `request` aparte): así la cookie de
  // mesa queda en el contexto del navegador y `page.request.post` la manda. Pedir exige esa
  // cookie, nunca el cuerpo (ver apps/web/lib/mesa-cookie.ts).
  await page.goto(`${BASE}/m/${GARUM_TABLE_TOKEN}`);

  const createResponse = await page.request.post(`${BASE}/api/orders`, {
    data: { lines: [{ productId, quantity: 2, extraIds: [], notes: null }] },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { publicToken } = (await createResponse.json()) as { publicToken: string };
  const { orderId } = await findOrderByPublicToken(publicToken);

  try {
    await page.goto(`${BASE}/pedido/${publicToken}`);

    await expect(page.getByTestId("receipt")).toBeVisible();

    const aviso = page.getByTestId("receipt-not-invoice");
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText("No válido como factura");

    // El desglose informativo: garum repercute IVA, así que base y cuota tienen que salir.
    await expect(page.getByTestId("receipt-tax-breakdown")).toBeVisible();
  } finally {
    await deleteOrder(orderId);
  }
});
