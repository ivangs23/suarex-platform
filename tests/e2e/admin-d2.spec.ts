import { expect, type Page, test } from "@playwright/test";
import {
  deleteDeviceForTest,
  deletePrinterForTest,
  deleteTableForTest,
} from "./helpers/admin-d2-db.js";

// Igual que `admin-catalogo.spec.ts`: requiere que el personal demo Y el owner demo ya
// estén sembrados (`pnpm seed:staff`, ver README). Nunca hardcodeamos ninguna contraseña
// en el repo -- `pnpm seed:staff` genera una aleatoria por rol y las guarda en
// `.env.test` (gitignorado), que `playwright.config.ts` ya carga.
const STAFF_PASSWORD = process.env.STAFF_SEED_PASSWORD;
const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

test.beforeAll(() => {
  // Deliberadamente un fallo, no un `test.skip`: un test saltado es indistinguible de uno
  // que pasa en un resumen de CI/local -- mismo gotcha que `admin-catalogo.spec.ts` ya
  // cerró. Si esto revienta, a este stack le falta sembrar personal y/o el owner demo, y
  // el mensaje lo dice explícitamente en vez de dejar pasar la suite en verde.
  expect(
    STAFF_PASSWORD,
    "Falta STAFF_SEED_PASSWORD: no hay personal sembrado en este stack. Corre " +
      "`pnpm seed:staff` (ver README) y vuelve a lanzar `pnpm test:e2e`.",
  ).toBeTruthy();
  expect(
    OWNER_PASSWORD,
    "Falta OWNER_SEED_PASSWORD: no hay owner demo sembrado en este stack. Corre " +
      "`pnpm seed:staff` (ver README) y vuelve a lanzar `pnpm test:e2e`.",
  ).toBeTruthy();
});

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Aterriza en /staff antes de seguir: confirma que el login real (vía Supabase Auth, no
  // una cookie fabricada a mano) dejó una sesión que el servidor reconoce.
  await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });
}

/**
 * Ids reales capturados desde el propio panel (atributos `data-*-id` de cada fila, ver
 * `page.tsx` de mesas/dispositivos/impresoras) en cuanto existen, para que
 * `test.afterEach` -- que SIEMPRE corre, a diferencia del cuerpo del test si una
 * aserción anterior revienta -- pueda borrarlos igualmente. `undefined` mientras no hay
 * nada que limpiar.
 */
let createdTableId: string | undefined;
let createdDeviceId: string | undefined;
let createdPrinterId: string | undefined;

test.afterEach(async () => {
  if (createdTableId) {
    const id = createdTableId;
    createdTableId = undefined;
    try {
      await deleteTableForTest(id);
    } catch (error) {
      // No relanzar: un fallo de limpieza no debe enmascarar el fallo real del test.
      console.error(`No se pudo borrar la mesa de prueba ${id}:`, error);
    }
  }
  if (createdDeviceId) {
    const id = createdDeviceId;
    createdDeviceId = undefined;
    try {
      await deleteDeviceForTest(id);
    } catch (error) {
      console.error(`No se pudo borrar el dispositivo de prueba ${id}:`, error);
    }
  }
  if (createdPrinterId) {
    const id = createdPrinterId;
    createdPrinterId = undefined;
    try {
      await deletePrinterForTest(id);
    } catch (error) {
      console.error(`No se pudo borrar la impresora de prueba ${id}:`, error);
    }
  }
});

test("un owner crea una mesa y ve su QR", async ({ page }) => {
  await login(page, "owner@garum.local", OWNER_PASSWORD as string);

  await page.goto("http://garum.localhost:3000/admin/mesas");
  await expect(page).toHaveURL("http://garum.localhost:3000/admin/mesas");
  await expect(page.locator("h1")).toHaveText("Gestión de mesas");

  const label = `E2E-${Date.now()}`;
  await page.getByLabel("Etiqueta").fill(label);
  await page.getByRole("button", { name: "Crear mesa" }).click();

  const tableRow = page.getByTestId("admin-table").filter({ hasText: label });
  await expect(tableRow).toBeVisible({ timeout: 15_000 });

  // El QR es un <svg> real (generado por `tableQrSvg` sobre una URL compuesta en el
  // servidor a partir del Host de la petición + el token de la mesa), no una imagen ni
  // un placeholder de texto.
  await expect(tableRow.locator("svg")).toBeVisible();

  createdTableId = (await tableRow.getAttribute("data-table-id")) ?? undefined;
  expect(createdTableId).toBeTruthy();
});

test("un owner da de alta un dispositivo y ve el código una vez", async ({ page }) => {
  await login(page, "owner@garum.local", OWNER_PASSWORD as string);

  await page.goto("http://garum.localhost:3000/admin/dispositivos");
  await expect(page.locator("h1")).toHaveText("Gestión de dispositivos");

  const name = `Agente cocina E2E ${Date.now()}`;
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Dar de alta" }).click();

  const pairingCode = page.getByTestId("pairing-code");
  await expect(pairingCode).toBeVisible({ timeout: 15_000 });
  const codeText = (await pairingCode.innerText()).trim();
  expect(codeText.length).toBeGreaterThanOrEqual(32);

  const deviceRow = page.getByTestId("admin-device").filter({ hasText: name });
  await expect(deviceRow).toBeVisible();
  createdDeviceId = (await deviceRow.getAttribute("data-device-id")) ?? undefined;
  expect(createdDeviceId).toBeTruthy();

  // El código de emparejamiento es de un solo uso visual: tras recargar la página ya no
  // se muestra en ningún sitio (no se persiste en el cliente, y `listDevices` nunca lo
  // vuelve a exponer -- ver `packages/db/src/admin-devices.ts`).
  await page.reload();
  await expect(page.getByTestId("pairing-code")).toHaveCount(0);
});

test("un owner configura una impresora de red", async ({ page }) => {
  await login(page, "owner@garum.local", OWNER_PASSWORD as string);

  await page.goto("http://garum.localhost:3000/admin/impresoras");
  await expect(page.locator("h1")).toHaveText("Gestión de impresoras");

  const name = `Cocina E2E ${Date.now()}`;
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Host").fill("127.0.0.1");
  await page.getByLabel("Puerto").fill("9100");
  await page.getByLabel("Destino").selectOption("cocina");
  await page.getByRole("button", { name: "Crear impresora" }).click();

  const printerRow = page.getByTestId("admin-printer").filter({ hasText: name });
  await expect(printerRow).toBeVisible({ timeout: 15_000 });
  await expect(printerRow.getByText("127.0.0.1:9100")).toBeVisible();

  createdPrinterId = (await printerRow.getAttribute("data-printer-id")) ?? undefined;
  expect(createdPrinterId).toBeTruthy();
});

test("un staff no ve la gestión de mesas/dispositivos/impresoras", async ({ page }) => {
  await login(page, "staff@garum.local", STAFF_PASSWORD as string);

  for (const path of ["/admin/mesas", "/admin/dispositivos", "/admin/impresoras"]) {
    await page.goto(`http://garum.localhost:3000${path}`);
    // `requireManager()` rechaza cualquier rol que no sea owner/admin -- un staff
    // autenticado (sesión real, no ausente) es redirigido a /staff/login igual que
    // alguien sin sesión, ver `apps/web/lib/require-manager.ts`.
    await expect(page).toHaveURL(/\/staff\/login/, { timeout: 15_000 });
  }
});
