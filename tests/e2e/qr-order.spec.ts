import { expect, test } from "@playwright/test";

/**
 * El recorrido del comensal: escanea el QR de su mesa y pide.
 *
 * El QR impreso codifica `/m/{token}` y ahí sigue, para siempre: hay mesas con ese código ya
 * pegado. Lo que hace ahora es fijar la mesa en una cookie httpOnly y mandar a `/{mesa}`, que
 * es LA carta -- la del tema del cliente. Antes había dos: una bonita que no vendía y otra
 * que vendía sin tema ninguno.
 */
const QR_MESA_1 = "http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111";
// Los vinos tintos del seed: es donde están "Ribera del Duero" (18 €) y su extra (3 €).
const TINTOS = "http://garum.localhost:3000/1?cat=tintos";

test("un token de mesa desconocido devuelve 404", async ({ page }) => {
  const response = await page.goto(
    "http://garum.localhost:3000/m/00000000-0000-0000-0000-000000000000",
  );
  expect(response?.status()).toBe(404);
});

test("el QR de la mesa lleva a la carta del cliente, con su tema", async ({ page }) => {
  await page.goto(QR_MESA_1);

  // Redirigido a `/{mesa}`: misma mesa, y ahora con el tema a medida de garum.
  await expect(page).toHaveURL("http://garum.localhost:3000/1");
  await expect(page.getByTestId("mesa")).toHaveText("Mesa 1");
  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "garum");
});

test("tras escanear se puede pedir, y el total se acumula", async ({ page }) => {
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();

  await page.getByTestId("add-to-cart").first().click();
  await page.getByTestId("add-to-cart").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("36,00 €");
});

test("elegir un extra suma su precio al total", async ({ page }) => {
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);

  await page.getByTestId("add-to-cart").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");

  await page.getByTestId("extra-checkbox").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("21,00 €");

  // Desmarcarla la resta de nuevo.
  await page.getByTestId("extra-checkbox").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");
});

test("el total sobrevive a cambiar de categoría", async ({ page }) => {
  // Un pedido real cae en categorías distintas: si el carrito se vaciara al navegar, no se
  // podría pedir un vino y una tosta en la misma comanda.
  await page.goto(QR_MESA_1);
  await page.goto(TINTOS);
  await page.getByTestId("add-to-cart").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");

  await page.goto("http://garum.localhost:3000/1?cat=blancos");
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");
});

test("sin escanear el QR, la carta se consulta pero no se pide", async ({ page }) => {
  // La cookie del QR es lo único que demuestra que quien pide está sentado en esa mesa. Sin
  // ella, cualquiera podría mandar comandas a una mesa ajena sabiendo solo su número.
  await page.goto(TINTOS);

  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();
  await expect(page.getByTestId("add-to-cart")).toHaveCount(0);
});

test("la cookie de una mesa no sirve para pedir desde otra", async ({ page }) => {
  // Control positivo del control negativo de arriba: se ESCANEA de verdad, y aun así la
  // mesa 5 no deja pedir porque lo escaneado fue la 1.
  await page.goto(QR_MESA_1);
  await page.goto("http://garum.localhost:3000/5?cat=tintos");

  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();
  await expect(page.getByTestId("add-to-cart")).toHaveCount(0);
});

test("la carta de un tenant no muestra productos de otro", async ({ page }) => {
  await page.goto(TINTOS);
  await expect(page.getByText("Tosta de jamón")).toHaveCount(0);
});
