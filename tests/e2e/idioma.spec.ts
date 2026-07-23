import { expect, test } from "@playwright/test";

/**
 * IDIOMA DE LA CARTA.
 *
 * El catálogo se guarda por idioma desde el principio (`name_i18n`) y la migración de Manuela
 * trajo sus traducciones, pero la carta enseñaba `es` a pelo: datos pagados y sin usar, y un
 * guiri en la terraza leyendo en español.
 *
 * El idioma va en la URL, no en una cookie, para que un enlace compartido enseñe lo mismo a
 * quien lo abra. Estos tests comprueban justo eso: que viaja, que sobrevive a navegar y que
 * no se ofrece un idioma que el cliente no tiene.
 */
const MANUELA = "http://manuela.localhost:3000/2";
const GARUM = "http://garum.localhost:3000/5";

test("el comensal cambia de idioma y la carta entera le sigue", async ({ page }) => {
  await page.goto(`${MANUELA}?ver=carta`);
  await expect(page.getByTestId("category").filter({ hasText: "Tostas" })).toBeVisible();

  await page.getByTestId("lang-option").filter({ hasText: "EN" }).click();

  // El catálogo del cliente, en inglés.
  await expect(page.getByTestId("category").filter({ hasText: "Toasts" })).toBeVisible();
  await expect(page.getByTestId("category").filter({ hasText: "Tostas" })).toHaveCount(0);
  // Y los textos que pone la plataforma, también: si estos siguieran en español, la carta
  // quedaría a medias y delataría que la traducción es solo de fachada.
  await expect(page.locator("body")).toContainText("dishes");
});

test("el idioma sobrevive a entrar en una categoría", async ({ page }) => {
  // Cada nivel es una carga de página nueva: si el enlace no arrastrara el idioma, el
  // comensal volvería al español a mitad de camino, que es lo que hace que nadie lo use.
  await page.goto(`${MANUELA}?ver=carta&lang=en`);

  await page.getByTestId("category").filter({ hasText: "Toasts" }).getByRole("link").click();

  await expect(page.getByTestId("product").filter({ hasText: "Ham toast" })).toBeVisible();
  // La pastilla de vuelta lleva el nombre de la categoría, también traducido: si el idioma se
  // hubiera perdido al entrar, aquí pondría "Tostas".
  await expect(page.getByTestId("breadcrumb")).toContainText("Toasts");
});

test("cambiar de idioma conserva dónde estabas", async ({ page }) => {
  // Mandar a la raíz al cambiar obligaría a rehacer toda la navegación.
  await page.goto(`${MANUELA}?cat=tostas`);
  await expect(page.getByTestId("product").filter({ hasText: "Tosta de jamón" })).toBeVisible();

  await page.getByTestId("lang-option").filter({ hasText: "EN" }).click();

  await expect(page.getByTestId("product").filter({ hasText: "Ham toast" })).toBeVisible();
});

test("la bienvenida también se puede cambiar de idioma", async ({ page }) => {
  // Es la PRIMERA pantalla: sin selector aquí, quien no lee español entra a ciegas.
  await page.goto(MANUELA);
  await expect(page.getByTestId("welcome-enter")).toBeVisible();

  await page.getByTestId("lang-option").filter({ hasText: "EN" }).click();

  await expect(page.getByTestId("welcome-enter")).toContainText("Tap to start");
});

test("un plato sin traducir se sigue viendo, en el idioma que tenga", async ({ page }) => {
  // De los 145 platos de Manuela solo una parte están traducidos. Un hueco en blanco en la
  // carta sería mucho peor que un nombre en otro idioma.
  await page.goto(`${MANUELA}?cat=cafes&lang=pt`);

  const productos = page.getByTestId("product");
  await expect(productos.first()).toBeVisible();
  // El seed no trae portugués: cae al español y ninguna tarjeta se queda sin nombre.
  await expect(productos.filter({ hasText: "Café con leche" })).toBeVisible();
});

test("un idioma manipulado en la URL no rompe la carta", async ({ page }) => {
  const response = await page.goto(`${MANUELA}?ver=carta&lang=klingon`);

  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("category").filter({ hasText: "Tostas" })).toBeVisible();
});

test("los idiomas salen de los datos del cliente, no de su tema", async ({ page }) => {
  // Garum tiene otro tema y otro catálogo, y también traducciones al inglés: ofrece el mismo
  // selector. Si esto dependiera del tema, cada cliente tendría la carta que le tocó según
  // quién lo escribió.
  //
  // El caso contrario -- un cliente con UN solo idioma no pinta selector -- lo cubre el test
  // de contrato de los temas, que puede fijar los datos; aquí no, porque los dos clientes del
  // seed tienen traducciones.
  await page.goto(`${GARUM}?ver=carta`);

  await expect(page.getByTestId("category").filter({ hasText: "Vinos" })).toBeVisible();
  await page.getByTestId("lang-option").filter({ hasText: "EN" }).click();
  await expect(page.getByTestId("category").filter({ hasText: "Wines" })).toBeVisible();
});
