import { expect, type Page, test } from "@playwright/test";
import {
  deleteDeviceForTest,
  deletePrinterForTest,
  seedPrinterNotReportedForTest,
} from "./helpers/admin-d2-db.js";

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

test("una USB con un nombre que su PC no ve sale avisada en el panel", async ({ page }) => {
  // El desplegable del formulario reduce el typo pero no lo elimina: está vacío hasta que el
  // agente late por primera vez, y en ese hueco se teclea a mano. Un nombre mal escrito no
  // falla de forma visible -- el agente pide a Windows una impresora que no existe y el ticket
  // se pierde. Esto comprueba que al menos se ve en pantalla.
  const sembrado = await seedPrinterNotReportedForTest(["EPSON TM-T20"], "EPSON TM-T2O");
  try {
    await login(page, "owner@garum.local", OWNER_PASSWORD as string);
    await page.goto("http://garum.localhost:3000/admin/impresoras");

    const aviso = page.getByTestId("usb-not-reported-warning");
    await expect(aviso).toBeVisible({ timeout: 15_000 });
    await expect(aviso, "hay que decir QUÉ PC no la ve").toContainText(sembrado.deviceName);
    await expect(aviso, "y el nombre exacto que hay configurado").toContainText("EPSON TM-T2O");
  } finally {
    await deletePrinterForTest(sembrado.printerId);
    await deleteDeviceForTest(sembrado.deviceId);
  }
});

test("una USB cuyo nombre SÍ reporta su PC no avisa de nada", async ({ page }) => {
  // Control negativo. Sin él, el test de arriba pasaría igual si el aviso saliera siempre --
  // y un aviso permanente se aprende a ignorar, incluido el día que dice la verdad.
  const sembrado = await seedPrinterNotReportedForTest(["EPSON TM-T20"], "EPSON TM-T20");
  try {
    await login(page, "owner@garum.local", OWNER_PASSWORD as string);
    await page.goto("http://garum.localhost:3000/admin/impresoras");

    await expect(page.locator("h1")).toHaveText("Gestión de impresoras");
    await expect(page.getByTestId("usb-not-reported-warning")).toHaveCount(0);
  } finally {
    await deletePrinterForTest(sembrado.printerId);
    await deleteDeviceForTest(sembrado.deviceId);
  }
});
