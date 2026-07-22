import { expect, type Page, test } from "@playwright/test";
import {
  deleteStaffByEmailForTest,
  restoreDemoSettings,
  type SettingsSnapshot,
  snapshotDemoSettings,
} from "./helpers/admin-d3-db.js";

const STAFF_PASSWORD = process.env.STAFF_SEED_PASSWORD;
const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

test.beforeAll(() => {
  expect(
    OWNER_PASSWORD,
    "Falta OWNER_SEED_PASSWORD: corre `pnpm seed:staff` y vuelve a lanzar `pnpm test:e2e`.",
  ).toBeTruthy();
  expect(
    STAFF_PASSWORD,
    "Falta STAFF_SEED_PASSWORD: corre `pnpm seed:staff` y vuelve a lanzar `pnpm test:e2e`.",
  ).toBeTruthy();
});

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });
}

// --- Ajustes: snapshot/restore de la marca compartida de garum ---
let settingsSnap: SettingsSnapshot | undefined;
let createdStaffEmail: string | undefined;

test.afterEach(async () => {
  if (settingsSnap) {
    const snap = settingsSnap;
    settingsSnap = undefined;
    try {
      await restoreDemoSettings(snap);
    } catch (error) {
      console.error("No se pudieron restaurar los ajustes de garum:", error);
    }
  }
  if (createdStaffEmail) {
    const email = createdStaffEmail;
    createdStaffEmail = undefined;
    try {
      await deleteStaffByEmailForTest(email);
    } catch (error) {
      console.error(`No se pudo borrar el camarero de prueba ${email}:`, error);
    }
  }
});

test("un owner cambia el nombre y un color, y se reflejan en la carta", async ({ page }) => {
  settingsSnap = await snapshotDemoSettings(); // se restaura pase lo que pase (afterEach)

  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/ajustes");
  await expect(page.locator("h1")).toHaveText("Ajustes del negocio");

  const newName = `Garum E2E ${Date.now()}`;
  await page.getByLabel("Nombre del negocio").fill(newName);
  // Un color primario nuevo, determinista.
  await page.getByLabel("Color primario").fill("#123456");
  await page.getByRole("button", { name: "Guardar ajustes" }).click();
  // DESVIACIÓN respecto al plan: el submit dispara la Server Action vía fetch (sin
  // navegación de por medio, `updateSettingsAction` solo hace `revalidatePath`, nunca
  // `redirect`). Navegar de inmediato a `/1` competía en una carrera real contra esa
  // petición en vuelo -- observado en este stack: el `POST` de la action confirmaba
  // escribir el nombre nuevo en la base (log de depuración), pero si `/1` cargaba ANTES
  // de que la escritura confirmara, esa carga SSR quedaba fijada con el nombre viejo para
  // siempre (una página ya renderizada no vuelve a pedir datos sola). Esperar a que la
  // red se quede inactiva confirma que la mutación ya resolvió antes de navegar.
  await page.waitForLoadState("networkidle");

  // El nombre se refleja en la carta pública (mesa 1). data-testid="tenant-name".
  await page.goto("http://garum.localhost:3000/1");
  await expect(page.getByTestId("tenant-name")).toHaveText(newName, { timeout: 15_000 });

  // El color primario llegó a las CSS vars del layout raíz.
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim(),
  );
  expect(primary).toBe("#123456");
});

test("un owner da de alta un camarero que luego entra al panel de comandas", async ({ page }) => {
  createdStaffEmail = `camarero-e2e-${Date.now()}@garum.local`; // se borra en afterEach

  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/personal");
  await expect(page.locator("h1")).toHaveText("Gestión de personal");

  await page.getByLabel("Email").fill(createdStaffEmail);
  await page.getByLabel("Contraseña (mín. 8)").fill("camarero-1234");
  await page.getByRole("button", { name: "Dar de alta" }).click();

  const row = page.getByTestId("staff-member").filter({ hasText: createdStaffEmail });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // El camarero recién creado inicia sesión y aterriza en el panel de comandas.
  await page.context().clearCookies();
  await login(page, createdStaffEmail, "camarero-1234");
  await expect(page).toHaveURL("http://garum.localhost:3000/staff");
});

test("un staff no ve ajustes ni personal", async ({ page }) => {
  await login(page, "staff@garum.local", STAFF_PASSWORD as string);
  for (const path of ["/admin/ajustes", "/admin/personal"]) {
    await page.goto(`http://garum.localhost:3000${path}`);
    await expect(page).toHaveURL(/\/staff\/login/, { timeout: 15_000 });
  }
});
