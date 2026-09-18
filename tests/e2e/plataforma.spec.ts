import { expect, test } from "@playwright/test";

/**
 * LA CONSOLA DE PLATAFORMA, DE PUNTA A PUNTA.
 *
 * La frontera de host ya la cubre `plataforma-host.spec.ts`. Lo que se prueba aquí es la otra
 * barrera: el guard. Sin sesión de superadmin, la consola no debe enseñar NADA -- ni siquiera
 * el slug de un cliente, que ya sería un mapa de a quién atacar.
 */

const PLATAFORMA = "http://admin.localhost:3000";
const EMAIL = process.env.PLATFORM_ADMIN_EMAIL;
const PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD;

test("sin sesión, la consola redirige al login y no filtra ningún cliente", async ({ page }) => {
  await page.goto(`${PLATAFORMA}/plataforma`);
  await expect(page).toHaveURL(/\/plataforma\/login/);

  const cuerpo = await page.locator("body").innerText();
  expect(cuerpo, "ni un slug de cliente puede asomar antes del guard").not.toContain("garum");
  expect(cuerpo).not.toContain("manuela");
});

test("el login es alcanzable sin sesión y no entra en bucle", async ({ page }) => {
  // Regresión del fallo clásico: guard en el layout en vez de en la página. El layout envuelve
  // también al login, así que el login redirigiría a sí mismo indefinidamente.
  const res = await page.goto(`${PLATAFORMA}/plataforma/login`);
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId("plataforma-login")).toBeVisible();
  await expect(page).toHaveURL(/\/plataforma\/login$/);
});

test("un superadmin entra y ve a todos los clientes", async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, "corre `node scripts/seed-platform-admin.mjs --email ...`");

  await page.goto(`${PLATAFORMA}/plataforma/login`);
  await page.getByLabel("Correo").fill(EMAIL as string);
  await page.getByLabel("Contraseña").fill(PASSWORD as string);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/plataforma$/);
  await expect(page.getByTestId("tenant-row").first()).toBeVisible();

  const cuerpo = await page.locator("body").innerText();
  expect(cuerpo).toContain("garum");
  expect(cuerpo).toContain("manuela");
  await expect(page.getByTestId("alta-cliente")).toBeVisible();
});

test("un owner de restaurante NO es superadmin", async ({ page }) => {
  // La separación entre `platform_admins` y `memberships`, comprobada por la puerta de
  // entrada: un owner con credenciales válidas de SU restaurante no entra en la consola.
  const ownerPassword = process.env.OWNER_SEED_PASSWORD;
  test.skip(!ownerPassword, "corre `pnpm seed:staff`");

  await page.goto(`${PLATAFORMA}/plataforma/login`);
  await page.getByLabel("Correo").fill("owner@garum.local");
  await page.getByLabel("Contraseña").fill(ownerPassword as string);
  await page.getByRole("button", { name: "Entrar" }).click();

  // La sesión de Auth es válida, pero no está en `platform_admins`: vuelve al login.
  await expect(page).toHaveURL(/\/plataforma\/login/);
  const cuerpo = await page.locator("body").innerText();
  expect(cuerpo).not.toContain("garum");
});
