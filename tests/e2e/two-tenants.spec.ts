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
  await page.goto("http://garum.localhost:3000/1");
  await expect(page.getByText("Tosta de jamón")).toHaveCount(0);

  await page.goto("http://manuela.localhost:3000/1");
  await expect(page.getByText("Ribera del Duero")).toHaveCount(0);
});

test("un host desconocido devuelve 404", async ({ page }) => {
  const response = await page.goto("http://desconocido.localhost:3000/1");
  expect(response?.status()).toBe(404);
});
