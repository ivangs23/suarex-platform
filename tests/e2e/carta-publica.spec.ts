import { expect, test } from "@playwright/test";
import { withChannels } from "./helpers/totem-db.js";

/**
 * LA CARTA DE CONSULTA EN `/`. Es el mismo render que `/{mesa}` sin mesa: se ve entera y no se
 * pide (pedir exige el QR de una mesa). Ver docs/decisions/0009-carta-publica-en-la-raiz.md.
 */
const ORIGIN = "http://garum.localhost:3000";

let restaurar: (() => Promise<void>) | null = null;

test.afterEach(async () => {
  // Siempre corre, aunque el test falle antes de llegar al final: el seed da los dos canales a
  // garum y el resto de la suite cuenta con ellos.
  await restaurar?.();
  restaurar = null;
});

test("la raíz del cliente es su carta, sin mesa", async ({ page }) => {
  const response = await page.goto(`${ORIGIN}/`);
  expect(response?.status()).toBe(200);

  // Primero la bienvenida, como en `/{mesa}`, y su enlace se queda en la raíz.
  await expect(page.getByTestId("tenant-name")).toHaveText("Garum Vinoteca");
  await expect(page.getByTestId("welcome-enter")).toHaveAttribute("href", "/?ver=carta");
  await expect(page.getByTestId("mesa")).toHaveCount(0);

  await page.getByTestId("welcome-enter").click();
  await expect(page).toHaveURL(`${ORIGIN}/?ver=carta`);
  await expect(page.getByTestId("category").filter({ hasText: "Vinos" })).toBeVisible();
  await expect(page.getByTestId("category").filter({ hasText: "Entrantes" })).toBeVisible();
  await expect(page.getByTestId("mesa")).toHaveCount(0);

  // El selector de idioma tampoco se va a una mesa.
  const hrefs = await page
    .getByTestId("lang-option")
    .evaluateAll((enlaces) => enlaces.map((a) => a.getAttribute("href")).filter(Boolean));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(href).toMatch(/^\/(\?|$)/);
});

test("en la raíz se navega por categorías y no se pide", async ({ page }) => {
  await page.goto(`${ORIGIN}/?cat=tintos`);

  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();
  await expect(page.getByTestId("product").filter({ hasText: "Rioja Crianza" })).toBeVisible();
  await expect(page.getByTestId("open-product-sheet")).toHaveCount(0);
  await expect(page.getByTestId("cart-open")).toHaveCount(0);
  await expect(page.getByTestId("scan-to-order")).toBeVisible();
});

test("ni con la mesa escaneada se pide desde la raíz", async ({ page }) => {
  // Control positivo: la misma cookie SÍ pide en su mesa; en `/` no hay mesa que designe.
  await page.goto(`${ORIGIN}/m/11111111-1111-1111-1111-111111111111`);
  await page.goto(`${ORIGIN}/1?cat=tintos`);
  await expect(page.getByTestId("open-product-sheet").first()).toBeVisible();

  await page.goto(`${ORIGIN}/?cat=tintos`);
  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();
  await expect(page.getByTestId("open-product-sheet")).toHaveCount(0);
});

test("un cliente sin el canal de QR no tiene carta en la raíz", async ({ page }) => {
  restaurar = await withChannels("garum", ["kiosko"]);
  const response = await page.goto(`${ORIGIN}/`);
  expect(response?.status()).toBe(404);
});

test("la raíz del host de plataforma sigue siendo 404", async ({ page }) => {
  const response = await page.goto("http://admin.localhost:3000/");
  expect(response?.status()).toBe(404);
});
