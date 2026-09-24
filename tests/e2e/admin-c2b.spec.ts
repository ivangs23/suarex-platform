import { expect, type Page, test } from "@playwright/test";
import {
  createDeviceWithPrintersForTest,
  createUsbPrinterForTest,
  deleteDeviceForTest,
  deletePrinterForTest,
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
let createdDeviceId: string | undefined;
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
  if (createdDeviceId) {
    const id = createdDeviceId;
    createdDeviceId = undefined;
    try {
      await deleteDeviceForTest(id);
    } catch (e) {
      console.error(`No se pudo borrar el dispositivo ${id}:`, e);
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

test("#7: elegir la impresora USB de un desplegable poblado por el dispositivo", async ({
  page,
}) => {
  // Un dispositivo que ya "reportó" sus impresoras (heartbeat con `printers`): el panel debe
  // ofrecerlas en un <select>, para que el owner ELIJA en vez de teclear (y arriesgar un typo
  // que hace que la USB no case y no imprima en silencio).
  const deviceName = `Agente E2E ${Date.now()}`;
  const reported = `EPSON-REPORTADA-${Date.now()}`;
  createdDeviceId = await createDeviceWithPrintersForTest(deviceName, [reported]);

  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/impresoras");
  await expect(page.locator("h1")).toHaveText("Gestión de impresoras");

  const name = `USB DROPDOWN ${Date.now()}`;
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Tipo de conexión").selectOption("usb");
  await page.getByLabel("Dispositivo (opcional)").selectOption({ label: deviceName });

  // El campo del nombre Windows ahora es un <select>: se ELIGE la impresora reportada, no se
  // teclea. `selectOption` fallaría si el campo siguiera siendo un input de texto.
  await page.getByLabel("Nombre de impresora Windows (solo USB)").selectOption(reported);
  await page.getByLabel("Destino").selectOption("cocina");
  await page.getByRole("button", { name: "Crear impresora" }).click();

  const row = page.getByTestId("admin-printer").filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(reported);
  createdPrinterId = (await row.getAttribute("data-printer-id")) ?? undefined;
  expect(createdPrinterId).toBeTruthy();
});

test("una USB con un nombre que su PC no ve sale avisada en el panel", async ({ page }) => {
  // El desplegable evita el typo cuando hay de dónde elegir, pero cae a texto libre mientras
  // el dispositivo no haya reportado -- y ahí un nombre mal escrito no falla de forma visible:
  // el agente pide a Windows una impresora que no existe y el ticket se pierde. Esto comprueba
  // que al menos queda dicho en pantalla.
  const deviceName = `PC E2E ${Date.now()}`;
  createdDeviceId = await createDeviceWithPrintersForTest(deviceName, ["EPSON TM-T20"]);
  createdPrinterId = (await createUsbPrinterForTest(createdDeviceId, "EPSON TM-T2O")).printerId;

  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/impresoras");

  const aviso = page.getByTestId("usb-not-reported-warning");
  await expect(aviso).toBeVisible({ timeout: 15_000 });
  await expect(aviso, "hay que decir QUÉ PC no la ve").toContainText(deviceName);
  await expect(aviso, "y el nombre exacto que hay configurado").toContainText("EPSON TM-T2O");
});

test("una USB cuyo nombre SÍ reporta su PC no avisa de nada", async ({ page }) => {
  // Control negativo. Sin él, el test de arriba pasaría igual si el aviso saliera siempre --
  // y un aviso permanente se aprende a ignorar, incluido el día que dice la verdad.
  createdDeviceId = await createDeviceWithPrintersForTest(`PC OK ${Date.now()}`, ["EPSON TM-T20"]);
  createdPrinterId = (await createUsbPrinterForTest(createdDeviceId, "EPSON TM-T20")).printerId;

  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/impresoras");

  await expect(page.locator("h1")).toHaveText("Gestión de impresoras");
  await expect(page.getByTestId("usb-not-reported-warning")).toHaveCount(0);
});

test("un totem sin impresora de recibo sale avisado en el panel", async ({ page }) => {
  // El aviso más grave de esta pantalla: no es un ticket de cocina que no sale, es alguien que
  // paga con tarjeta en el totem y se va sin justificante. Ese comensal no tiene recibo digital
  // -- tras pagar solo ve el código de recogida en pantalla -- así que el papel es el único que
  // puede llevarse, y sin impresora de recibo el pedido se marca impreso igualmente.
  createdDeviceId = await createDeviceWithPrintersForTest(
    `Totem E2E ${Date.now()}`,
    [],
    ["kiosko"],
  );

  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/impresoras");

  const aviso = page.getByTestId("totem-sin-recibo-warning");
  await expect(aviso).toBeVisible({ timeout: 15_000 });
  await expect(aviso, "hay que decir QUÉ local").toContainText("Principal");
});

test("sin totem, ese aviso no aparece", async ({ page }) => {
  // Control negativo: la mayoría de clientes no tiene totem y el canal QR no necesita recibo
  // impreso (ese comensal tiene el suyo digital). Un aviso permanente se aprende a ignorar.
  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/impresoras");

  await expect(page.locator("h1")).toHaveText("Gestión de impresoras");
  await expect(page.getByTestId("totem-sin-recibo-warning")).toHaveCount(0);
});
