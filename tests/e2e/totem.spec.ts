import { expect, type Page, test } from "@playwright/test";
import { clearAllRateLimits, deleteOrder, latestOrderForTenant } from "./helpers/orders-db.js";
import { deleteDevice, kioskoOrderInfo, seedTotemDevice } from "./helpers/totem-db.js";

/**
 * EL RECORRIDO DEL TOTEM, de punta a punta.
 *
 * La carta es la MISMA que la de la mesa (tema del cliente, navegación por `?cat=`); lo que el
 * totem añade es el envoltorio genérico: bienvenida -> para llevar / en mesa -> mesa -> carta ->
 * pago por datáfono -> recogida. El cobro real lo hace el agente-desktop (`window.totem.pay`); en
 * e2e se inyecta un puente de mentira, porque aquí se prueba la UI del flujo, no el datáfono.
 */

const ORIGIN = "http://garum.localhost:3000";
let deviceId: string;
let token: string;

test.beforeAll(async () => {
  const seeded = await seedTotemDevice("garum");
  deviceId = seeded.deviceId;
  token = seeded.token;
});

test.afterAll(async () => {
  if (deviceId) await deleteDevice(deviceId);
});

test.beforeEach(async () => {
  await clearAllRateLimits();
});

/** Inyecta el puente `window.totem` con el veredicto que cada test quiera (aprobar/rechazar). */
async function stubTotemBridge(page: Page, result: { ok: boolean; reason?: string }) {
  await page.addInitScript((r) => {
    (window as unknown as { totem: unknown }).totem = {
      pay: async () =>
        r.ok ? { ok: true, authCode: "TEST-AUTH" } : { ok: false, reason: r.reason },
    };
  }, result);
}

/** Añade el Ribera del Duero (18 €) a la carta del totem, ya en el paso de carta. */
async function añadeProducto(page: Page) {
  await page.goto(`${ORIGIN}/totem/${token}?cat=tintos`);
  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  await tarjeta.getByTestId("open-product-sheet").click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();
}

test("un token de totem desconocido devuelve 404", async ({ page }) => {
  const response = await page.goto(`${ORIGIN}/totem/00000000-0000-0000-0000-000000000000`);
  expect(response?.status()).toBe(404);
});

test("en mesa: bienvenida -> mesa -> carta -> pago -> recogida, y crea el pedido kiosko", async ({
  page,
}) => {
  await stubTotemBridge(page, { ok: true });
  await page.goto(`${ORIGIN}/totem/${token}`);

  // Bienvenida con la marca del cliente.
  await expect(page.getByTestId("totem-welcome")).toBeVisible();
  await expect(page.getByTestId("totem-welcome")).toContainText("Garum Vinoteca");
  await page.getByTestId("totem-start").click();

  // Para llevar / en mesa -> en mesa.
  await page.getByTestId("totem-dinein").click();

  // Teclado: mesa 12.
  await page.getByTestId("totem-key-1").click();
  await page.getByTestId("totem-key-2").click();
  await expect(page.getByTestId("totem-table-display")).toHaveText("12");
  await page.getByTestId("totem-table-next").click();

  // Carta: se añade un producto (el paso sobrevive a navegar de categoría por `sessionStorage`).
  await añadeProducto(page);

  // Pagar: se crea el pedido (pending, canal kiosko) y se pasa al datáfono.
  await page.getByTestId("cart-open").click();
  await page.getByTestId("cart-panel").getByTestId("cart-pay").click();

  const pago = page.getByTestId("totem-pay");
  await expect(pago).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("totem-pay-total")).toHaveText("18,00 €");

  // El pedido ya existe: se comprueba que es kiosko y lleva la mesa tecleada.
  const { orderId } = await latestOrderForTenant("garum");
  try {
    const info = await kioskoOrderInfo(orderId);
    expect(info.channel).toBe("kiosko");
    expect(info.tableLabel).toBe("12");

    // Cobro aprobado por el datáfono (de mentira) -> pantalla de recogida con la mesa.
    await page.getByTestId("totem-pay-start").click();
    await expect(page.getByTestId("totem-done")).toBeVisible();
    await expect(page.getByTestId("totem-done-table")).toContainText("12");
  } finally {
    await deleteOrder(orderId);
  }
});

test("para llevar: se salta la mesa y la recogida muestra un número, no una mesa", async ({
  page,
}) => {
  await stubTotemBridge(page, { ok: true });
  await page.goto(`${ORIGIN}/totem/${token}`);

  await page.getByTestId("totem-start").click();
  // Para llevar salta directo a la carta, sin teclado de mesa.
  await page.getByTestId("totem-takeaway").click();
  await expect(page.getByTestId("totem-table")).toHaveCount(0);

  await añadeProducto(page);
  await page.getByTestId("cart-open").click();
  await page.getByTestId("cart-panel").getByTestId("cart-pay").click();
  await expect(page.getByTestId("totem-pay")).toBeVisible({ timeout: 30_000 });

  const { orderId } = await latestOrderForTenant("garum");
  try {
    const info = await kioskoOrderInfo(orderId);
    expect(info.channel).toBe("kiosko");
    // Para llevar: sin mesa.
    expect(info.tableLabel).toBeNull();

    await page.getByTestId("totem-pay-start").click();
    await expect(page.getByTestId("totem-done")).toBeVisible();
    // No hay mesa: se enseña un número de recogida.
    await expect(page.getByTestId("totem-done-table")).toHaveCount(0);
    await expect(page.getByTestId("totem-done-pickup")).toBeVisible();
  } finally {
    await deleteOrder(orderId);
  }
});

test("un pago rechazado se puede reintentar, sin marcar el pedido pagado", async ({ page }) => {
  await stubTotemBridge(page, { ok: false, reason: "Fondos insuficientes" });
  await page.goto(`${ORIGIN}/totem/${token}`);

  await page.getByTestId("totem-start").click();
  await page.getByTestId("totem-takeaway").click();
  await añadeProducto(page);
  await page.getByTestId("cart-open").click();
  await page.getByTestId("cart-panel").getByTestId("cart-pay").click();
  await expect(page.getByTestId("totem-pay")).toBeVisible({ timeout: 30_000 });

  const { orderId } = await latestOrderForTenant("garum");
  try {
    await page.getByTestId("totem-pay-start").click();
    // Rechazado: se ve el motivo y se puede reintentar; NO se pasa a recogida.
    await expect(page.getByTestId("totem-pay-error")).toContainText("Fondos insuficientes");
    await expect(page.getByTestId("totem-pay-retry")).toBeVisible();
    await expect(page.getByTestId("totem-done")).toHaveCount(0);

    // El pedido sigue pending: no se ha cobrado nada.
    expect((await kioskoOrderInfo(orderId)).status).toBe("pending");
  } finally {
    await deleteOrder(orderId);
  }
});

test("sin datáfono (fuera de un totem) no se finge un cobro: se dice que no está disponible", async ({
  page,
}) => {
  // No se inyecta `window.totem`: es un navegador normal, no un totem.
  await page.goto(`${ORIGIN}/totem/${token}`);

  await page.getByTestId("totem-start").click();
  await page.getByTestId("totem-takeaway").click();
  await añadeProducto(page);
  await page.getByTestId("cart-open").click();
  await page.getByTestId("cart-panel").getByTestId("cart-pay").click();
  await expect(page.getByTestId("totem-pay")).toBeVisible({ timeout: 30_000 });

  const { orderId } = await latestOrderForTenant("garum");
  try {
    await expect(page.getByTestId("totem-pay-unavailable")).toBeVisible();
    await expect(page.getByTestId("totem-pay-start")).toHaveCount(0);
  } finally {
    await deleteOrder(orderId);
  }
});
