import { expect, test } from "@playwright/test";
import {
  clearAllRateLimits,
  clearRateLimit,
  deleteOrder,
  deleteOrdersForTenant,
  firstProductIdOfTenant,
  latestOrderForTenant,
  tableIdForToken,
} from "./helpers/orders-db.js";

const BASE = "http://garum.localhost:3000";

/**
 * EL PASO DE PAGO, DENTRO DEL PANEL DEL PEDIDO.
 *
 * "Pagar" ya no salta a otra pantalla: crea el pedido (pending) y abre el formulario de
 * tarjeta de Stripe en el propio panel, con el pedido a la vista. Al confirmarse, el webhook
 * de Stripe marca el pedido `paid`.
 *
 * QUÉ CUBRE ESTE TEST Y QUÉ NO. Cubre TODO el cableado hasta el borde de Stripe: que "Pagar"
 * crea el pedido, monta Stripe Elements con el `clientSecret` real, y que "volver" cancela
 * sin cobrar. NO teclea el número de tarjeta: ese campo vive en un iframe cross-origin de
 * Stripe y automatizarlo es frágil y lento. La confirmación real con la tarjeta de test
 * (4242 4242 4242 4242) se comprueba a mano en modo pruebas -- ver `PaymentStep.tsx`.
 */
const QR_MESA_1 = "http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111";
const TINTOS = "http://garum.localhost:3000/1?cat=tintos";

async function pedirYPagar(page: import("@playwright/test").Page) {
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);
  await page
    .getByTestId("product")
    .filter({ hasText: "Ribera del Duero" })
    .getByTestId("open-product-sheet")
    .click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();
  await page.getByTestId("cart-open").click();
  await page.getByTestId("cart-panel").getByTestId("cart-pay").click();
}

test.beforeEach(async () => {
  await clearAllRateLimits();
});

test("Pagar crea el pedido y monta el formulario de tarjeta con el total", async ({ page }) => {
  await pedirYPagar(page);

  const paso = page.getByTestId("payment-step");
  await expect(paso).toBeVisible({ timeout: 30_000 });
  // El botón lleva el total: el comensal ve lo que va a pagar en el propio botón.
  await expect(page.getByTestId("payment-submit")).toHaveText(/18,00\s*€/);
  // Stripe Elements monta su iframe: el formulario es real, no un maqueta.
  await expect(page.locator('iframe[src*="js.stripe.com"]').first()).toBeAttached({
    timeout: 30_000,
  });

  // El pedido ya existe (pending), aunque no se haya cobrado: se limpia.
  const { orderId } = await latestOrderForTenant("garum");
  await deleteOrder(orderId);
});

test("volver al pedido cancela el cobro sin pagar", async ({ page }) => {
  await pedirYPagar(page);
  await expect(page.getByTestId("payment-step")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("payment-back").click();

  // De vuelta en la lista del pedido, con su total intacto: no se ha cobrado nada y el
  // comensal puede corregir o reintentar.
  await expect(page.getByTestId("payment-step")).toHaveCount(0);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-panel-total")).toHaveText("18,00 €");

  const { orderId } = await latestOrderForTenant("garum");
  await deleteOrder(orderId);
});

test("una mesa no puede saturar la cocina: al superar el tope se rechaza (429)", async ({
  page,
}) => {
  // Sin esto, quien fotografíe el QR repite la petición sin límite. El tope es por mesa: se
  // escanea una vez y luego se dispara por encima del máximo; el pedido que lo supera se
  // rechaza con 429, no con un pedido más para la impresora.
  // Mesa 2, aparte de la que usan los otros tests de este fichero: su contador es propio y no
  // arrastra los pedidos que ellos crearon en la mesa 1 dentro de la misma ventana de 2 min.
  const MESA_2 = "http://garum.localhost:3000/m/22222222-2222-2222-2222-222222222222";
  await page.goto(MESA_2); // fija la cookie de la mesa 2
  await clearRateLimit(await tableIdForToken("22222222-2222-2222-2222-222222222222"));
  const productId = await firstProductIdOfTenant("garum");
  const cuerpo = { lines: [{ productId, quantity: 1, extraIds: [], notes: null }] };

  const estados: number[] = [];
  // ORDER_RATE_MAX = 10 en una ventana de 2 min: 10 pasan, el 11º se rechaza.
  for (let i = 0; i < 11; i++) {
    const r = await page.request.post(`${BASE}/api/orders`, { data: cuerpo });
    estados.push(r.status());
  }

  try {
    // Los 10 primeros crean pedido (200); el 11º es 429.
    expect(estados.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(estados[10]).toBe(429);
  } finally {
    // Los 10 pedidos son reales: se borran todos los de la mesa.
    await deleteOrdersForTenant("garum");
  }
});
