import { expect, test } from "@playwright/test";

test("garum sirve su catálogo y su marca", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/5");

  await expect(page.getByTestId("tenant-name")).toHaveText("garum");
  await expect(page.getByTestId("mesa")).toHaveText("Mesa 5");
  await expect(page.getByTestId("product")).toHaveText(/Ribera del Duero/);

  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  );
  expect(bg).toBe("#d6e8d2");
});

test("manuela sirve un catálogo y una marca distintos", async ({ page }) => {
  await page.goto("http://manuela.localhost:3000/2");

  await expect(page.getByTestId("tenant-name")).toHaveText("manuela");
  await expect(page.getByTestId("product")).toHaveText(/Tosta de jamón/);

  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  );
  expect(bg).toBe("#fff8e7");
});

test("ningún producto de un tenant aparece en el otro", async ({ page }) => {
  // `product-count` refleja el tamaño crudo de getProducts(tenant.id), sin
  // pasar por el filtrado por category_id que hace MenuPage al renderizar.
  // Si solo se comprobara la ausencia del texto del otro tenant, un
  // getProducts() sin `tenant_id` seguiría sin fugar nada visible aquí: el
  // producto huérfano no tendría ninguna category_id de este tenant y el
  // `.filter((product) => product.categoryId === category.id)` de MenuPage lo
  // ocultaría igualmente. Comprobar el conteo crudo sí depende únicamente del
  // scoping de getProducts, independiente de si getCategories está bien
  // acotado.
  await page.goto("http://garum.localhost:3000/1");
  await expect(page.getByTestId("product-count")).toHaveText("1");
  await expect(page.getByText("Tosta de jamón")).toHaveCount(0);

  await page.goto("http://manuela.localhost:3000/1");
  await expect(page.getByTestId("product-count")).toHaveText("1");
  await expect(page.getByText("Ribera del Duero")).toHaveCount(0);
});

test("un host desconocido devuelve 404", async ({ page }) => {
  const response = await page.goto("http://desconocido.localhost:3000/1");
  expect(response?.status()).toBe(404);
});
