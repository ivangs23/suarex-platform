import { expect, type Page, test } from "@playwright/test";

/**
 * EL INFORME DE VENTAS.
 *
 * Lo que se comprueba de punta a punta es que la pantalla existe, está detrás del guard de
 * gestor y no revienta cuando todavía no hay ventas — que es el estado en el que la verá un
 * cliente recién dado de alta, y el más fácil de romper con un `Math.max` sobre un array
 * vacío o una división por cero.
 *
 * Los números en sí los cubre `tests/integration/reports.test.ts`, que puede crear pedidos con
 * estados e importes concretos sin depender de la UI.
 */
const BASE = "http://garum.localhost:3000";

// Mismo helper que el resto de specs de administración: el campo se llama "Email", no
// "Correo" (inventarlo costó tres timeouts de 60 s).
async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE}/staff/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(`${BASE}/staff`, { timeout: 15_000 });
}

test("sin sesión de gestor, el informe no se sirve", async ({ page }) => {
  await page.goto(`${BASE}/admin/informes`);
  await expect(page).toHaveURL(/\/staff\/login/);
});

test("un owner ve el informe del día", async ({ page }) => {
  const password = process.env.OWNER_SEED_PASSWORD;
  test.skip(!password, "corre `pnpm seed:staff`");
  await login(page, "owner@garum.local", password as string);

  await page.goto(`${BASE}/admin/informes`);
  await expect(page.getByTestId("informe-resumen")).toBeVisible();
  await expect(page.getByTestId("informe-total")).toBeVisible();

  // Sin ventas hoy en el seed: la pantalla lo dice en vez de pintar tablas vacías o romperse.
  await expect(page.getByTestId("informe-vacio")).toBeVisible();
});

test("el informe aparece en la navegación del panel", async ({ page }) => {
  const password = process.env.OWNER_SEED_PASSWORD;
  test.skip(!password, "corre `pnpm seed:staff`");
  await login(page, "owner@garum.local", password as string);

  await page.goto(`${BASE}/admin/catalogo`);
  await expect(page.getByRole("link", { name: "Informes" })).toBeVisible();
});

test("el histórico de pedidos es alcanzable y está tras el guard", async ({ page }) => {
  const sinSesion = await page.goto(`${BASE}/admin/pedidos`);
  expect(sinSesion?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/staff\/login/);

  const password = process.env.OWNER_SEED_PASSWORD;
  test.skip(!password, "corre `pnpm seed:staff`");
  await login(page, "owner@garum.local", password as string);

  await page.goto(`${BASE}/admin/pedidos`);
  // El seed no trae pedidos: la pantalla lo dice en vez de romperse con una lista vacía.
  await expect(page.getByTestId("pedidos-vacio")).toBeVisible();
  await expect(page.getByRole("link", { name: "Pedidos" })).toBeVisible();
});
