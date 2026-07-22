import { expect, type Page, test } from "@playwright/test";
import { deletePrinterForTest } from "./helpers/admin-d2-db.js";

const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

test.beforeAll(() => {
  expect(OWNER_PASSWORD, "Falta OWNER_SEED_PASSWORD: corre `pnpm seed:staff`.").toBeTruthy();
});

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });
}

let createdPrinterId: string | undefined;
test.afterEach(async () => {
  if (createdPrinterId) {
    const id = createdPrinterId;
    createdPrinterId = undefined;
    try {
      await deletePrinterForTest(id);
    } catch (e) {
      console.error(`No se pudo borrar la impresora ${id}:`, e);
    }
  }
});

test("un owner da de alta una impresora USB", async ({ page }) => {
  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/impresoras");
  await expect(page.locator("h1")).toHaveText("Gestión de impresoras");

  const name = `USB E2E ${Date.now()}`;
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Tipo de conexión").selectOption("usb");
  await page.getByLabel("Nombre de impresora Windows (solo USB)").fill("EPSON TM-T20");
  await page.getByLabel("Destino").selectOption("cocina");
  await page.getByRole("button", { name: "Crear impresora" }).click();

  const row = page.getByTestId("admin-printer").filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  createdPrinterId = (await row.getAttribute("data-printer-id")) ?? undefined;
  expect(createdPrinterId).toBeTruthy();
});
