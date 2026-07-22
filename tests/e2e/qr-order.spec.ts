import { expect, test } from "@playwright/test";

const MESA_1 = "http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111";

test("un token de mesa desconocido devuelve 404", async ({ page }) => {
  const response = await page.goto(
    "http://garum.localhost:3000/m/00000000-0000-0000-0000-000000000000",
  );
  expect(response?.status()).toBe(404);
});

test("la carta de la mesa muestra los productos del tenant", async ({ page }) => {
  await page.goto(MESA_1);
  await expect(page.getByTestId("mesa-label")).toHaveText("1");
  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();
});

test("añadir al carrito acumula el total del lado del cliente", async ({ page }) => {
  await page.goto(MESA_1);
  await page.getByTestId("add-to-cart").first().click();
  await page.getByTestId("add-to-cart").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("36,00 €");
});

test("la carta de un tenant no muestra productos de otro", async ({ page }) => {
  await page.goto(MESA_1);
  await expect(page.getByText("Tosta de jamón")).toHaveCount(0);
});

test("elegir un extra suma su precio al total del carrito del lado del cliente", async ({
  page,
}) => {
  await page.goto(MESA_1);
  await page.getByTestId("add-to-cart").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");

  await page.getByTestId("extra-checkbox").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("21,00 €");

  // Desmarcarla la resta de nuevo.
  await page.getByTestId("extra-checkbox").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("18,00 €");
});
