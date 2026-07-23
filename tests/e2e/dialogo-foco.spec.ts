import { expect, test } from "@playwright/test";
import { clearAllRateLimits } from "./helpers/orders-db.js";

/**
 * FOCO ATRAPADO EN LOS DIÁLOGOS.
 *
 * La ficha del producto y el panel del pedido son `aria-modal`: mientras están abiertos, el
 * resto de la carta no debe existir para el teclado. Sin trap, tabulando el foco se escapa a
 * la carta de detrás -- tapada por el overlay pero enfocable -- y quien navega con teclado o
 * lector de pantalla acaba "escribiendo" en una pantalla que no ve. Al cerrar, el foco vuelve
 * al botón que abrió el diálogo, no al principio de la página.
 */
const QR_MESA_1 = "http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111";
const TINTOS = "http://garum.localhost:3000/1?cat=tintos";

test.beforeEach(async () => {
  await clearAllRateLimits();
});

test("la ficha atrapa el foco y lo devuelve al cerrar con Escape", async ({ page }) => {
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  const tarjeta = page.getByTestId("product").filter({ hasText: "Ribera del Duero" });
  const abrir = tarjeta.getByTestId("open-product-sheet");
  await abrir.click();

  const ficha = page.getByTestId("product-sheet");
  await expect(ficha).toBeVisible();

  // Tabula muchas veces: el foco NUNCA sale de la ficha, por mucho que se insista.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    const dentro = await ficha.evaluate((n) => n.contains(document.activeElement));
    expect(dentro, `Tab #${i + 1} sacó el foco de la ficha`).toBe(true);
  }

  // Escape cierra, y el foco vuelve al botón que la abrió -- no a "ninguna parte".
  await page.keyboard.press("Escape");
  await expect(ficha).toHaveCount(0);
  await expect(abrir).toBeFocused();
});

test("el panel del pedido también atrapa el foco", async ({ page }) => {
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  await page
    .getByTestId("product")
    .filter({ hasText: "Ribera del Duero" })
    .getByTestId("open-product-sheet")
    .click();
  await page.getByTestId("product-sheet").getByTestId("sheet-add").click();
  await page.getByTestId("cart-open").click();

  const panel = page.getByTestId("cart-panel");
  await expect(panel).toBeVisible();

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const dentro = await panel.evaluate((n) => n.contains(document.activeElement));
    expect(dentro, `Tab #${i + 1} sacó el foco del panel`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});
