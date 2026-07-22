import { expect, test } from "@playwright/test";

test("garum sirve su catálogo, su marca y su tema", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/5");

  // El nombre visible sale de `branding.name` (D3), no del slug.
  await expect(page.getByTestId("tenant-name")).toHaveText("Garum Vinoteca");
  await expect(page.getByTestId("mesa")).toHaveText("Mesa 5");

  // Tema A MEDIDA de garum (ver apps/web/app/[mesa]/themes).
  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "garum");

  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  );
  expect(bg).toBe("#d6e8d2");

  // La carta se navega por NIVELES: la raíz enseña categorías, no productos.
  await expect(page.getByTestId("product")).toHaveCount(0);
  const vinos = page.getByTestId("category").filter({ hasText: "Vinos" });
  // 3 vinos repartidos entre Tintos y Blancos: la tarjeta cuenta TODO su subárbol,
  // no solo los productos que cuelgan directamente de ella (que son cero).
  await expect(vinos).toContainText("3 platos");

  await vinos.getByRole("link").click();
  const tintos = page.getByTestId("category").filter({ hasText: "Tintos" });
  await expect(tintos).toContainText("2 platos");

  await tintos.getByRole("link").click();
  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toHaveCount(1);
  // El rastro de vuelta cubre el nivel intermedio del que venimos.
  await expect(page.locator("nav")).toContainText("Vinos");
});

test("manuela sirve un catálogo, una marca y un tema distintos", async ({ page }) => {
  await page.goto("http://manuela.localhost:3000/2");

  await expect(page.getByTestId("tenant-name")).toHaveText("Manuela Desayuna");
  await expect(page.locator("[data-theme]")).toHaveAttribute("data-theme", "manuela");

  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim(),
  );
  expect(bg).toBe("#f9f7f2");

  // Carta plana (un solo nivel): al entrar en una categoría raíz ya salen sus productos.
  await page.getByTestId("category").filter({ hasText: "Tostas" }).getByRole("link").click();
  await expect(page.getByTestId("product").filter({ hasText: "Tosta de jamón" })).toHaveCount(1);
});

test("ningún producto de un tenant aparece en el otro", async ({ page }) => {
  // `product-count` refleja el tamaño crudo de getProducts(tenant.id), sin pasar por el
  // filtrado por categoría que hace `buildMenuView` al resolver el nivel. Si solo se
  // comprobara la ausencia del texto del otro tenant, un getProducts() sin `tenant_id`
  // seguiría sin fugar nada visible aquí: el producto huérfano no colgaría de ninguna
  // categoría de este tenant y el nivel no lo pintaría igualmente. Comprobar el conteo
  // crudo sí depende únicamente del scoping de getProducts, independiente de si
  // getCategories está bien acotado.
  //
  // 8 productos por tenant en el seed.
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
