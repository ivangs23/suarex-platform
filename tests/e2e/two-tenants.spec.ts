import { expect, test } from "@playwright/test";

test("garum sirve su catálogo, su marca y su tema", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/5");

  // El nombre visible sale de `branding.name` (D3), no del slug.
  await expect(page.getByTestId("tenant-name")).toHaveText("Garum Vinoteca");
  await expect(page.getByTestId("mesa")).toHaveText("Mesa 5");
  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toHaveCount(1);

  // Tema A MEDIDA de garum (ver apps/web/app/[mesa]/themes).
  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "garum");

  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  );
  expect(bg).toBe("#d6e8d2");
});

test("manuela sirve un catálogo, una marca y un tema distintos", async ({ page }) => {
  await page.goto("http://manuela.localhost:3000/2");

  await expect(page.getByTestId("tenant-name")).toHaveText("Manuela Desayuna");
  await expect(page.getByTestId("product").filter({ hasText: "Tosta de jamón" })).toHaveCount(1);

  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "manuela");

  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  );
  expect(bg).toBe("#f9f7f2");
});

test("ningún producto de un tenant aparece en el otro", async ({ page }) => {
  // `product-count` refleja el tamaño crudo de getProducts(tenant.id), sin
  // pasar por el filtrado por category_id que hace la página al construir el
  // catálogo del tema. Si solo se comprobara la ausencia del texto del otro
  // tenant, un getProducts() sin `tenant_id` seguiría sin fugar nada visible
  // aquí: el producto huérfano no tendría ninguna category_id de este tenant y
  // el `.filter((product) => product.categoryId === category.id)` lo ocultaría
  // igualmente. Comprobar el conteo crudo sí depende únicamente del scoping de
  // getProducts, independiente de si getCategories está bien acotado.
  //
  // 8 productos por tenant en el seed (3 + 3 + 2 en sus tres categorías).
  await page.goto("http://garum.localhost:3000/1");
  await expect(page.getByTestId("product-count")).toHaveText("8");
  await expect(page.getByText("Tosta de jamón")).toHaveCount(0);

  await page.goto("http://manuela.localhost:3000/1");
  await expect(page.getByTestId("product-count")).toHaveText("8");
  await expect(page.getByText("Ribera del Duero")).toHaveCount(0);
});

test("un host desconocido devuelve 404", async ({ page }) => {
  const response = await page.goto("http://desconocido.localhost:3000/1");
  expect(response?.status()).toBe(404);
});
