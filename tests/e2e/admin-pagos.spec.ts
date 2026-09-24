import { expect, type Page, test } from "@playwright/test";
import {
  deleteDevice,
  deletePaymentConfig,
  deviceRolesAndPinpad,
  seedPlainDevice,
} from "./helpers/totem-db.js";

/**
 * Fase 6 (cierre) del modo totem: el owner configura Paytef y activa el rol kiosko de un totem
 * desde el panel. Mismo login real que el resto de e2e de admin (`admin-catalogo.spec.ts`);
 * requiere el owner demo sembrado (`pnpm seed:staff`).
 */
const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;
const ORIGIN = "http://garum.localhost:3000";

test.beforeAll(() => {
  expect(
    OWNER_PASSWORD,
    "Falta OWNER_SEED_PASSWORD: corre `pnpm seed:staff` y reintenta.",
  ).toBeTruthy();
});

async function loginOwner(page: Page): Promise<void> {
  await page.goto(`${ORIGIN}/staff/login`);
  await page.getByLabel("Email", { exact: true }).fill("owner@garum.local");
  await page.getByLabel("Contraseña", { exact: true }).fill(OWNER_PASSWORD as string);
  await page.getByRole("button", { name: "Entrar" }).click();
  // URL EXACTA (no un regex laxo que casaría `/staff/login`): así se espera a que el login real
  // redirija a `/staff`, prueba de que la sesión ya existe antes de tocar `/admin/*`.
  await expect(page).toHaveURL(`${ORIGIN}/staff`, { timeout: 15_000 });
}

test("el owner guarda la config Paytef y el secreto no reaparece; en blanco se conserva", async ({
  page,
}) => {
  await loginOwner(page);
  try {
    await page.goto(`${ORIGIN}/admin/pagos`);
    await page.getByLabel(/Clave de acceso/).fill("AK-e2e");
    await page.getByLabel(/Clave secreta/).fill("sk-e2e-secreta");
    await page.getByLabel(/Company ID/).fill("999");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByTestId("payment-config-ok")).toBeVisible();

    // Al recargar, la clave de acceso persiste y el secreto NO baja al navegador (campo vacío,
    // placeholder de "guardada"); su valor no aparece en el HTML.
    await page.goto(`${ORIGIN}/admin/pagos`);
    await expect(page.getByLabel(/Clave de acceso/)).toHaveValue("AK-e2e");
    await expect(page.getByLabel(/Clave secreta/)).toHaveValue("");
    expect(await page.content()).not.toContain("sk-e2e-secreta");

    // Guardar de nuevo sin tocar el secreto lo conserva.
    await page.getByLabel(/Company ID/).fill("111");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByTestId("payment-config-ok")).toBeVisible();
  } finally {
    await deletePaymentConfig("garum");
  }
});

test("el owner activa el rol kiosko de un dispositivo y le fija el pinpad", async ({ page }) => {
  const { deviceId } = await seedPlainDevice("garum");
  await loginOwner(page);
  try {
    await page.goto(`${ORIGIN}/admin/dispositivos`);
    const card = page.locator(`[data-testid="admin-device"][data-device-id="${deviceId}"]`);
    await expect(card).toBeVisible();

    // Activa el totem (kiosko) y guarda.
    await card.getByTestId("device-role-kiosko").check();
    await card.getByTestId("device-roles-save").click();

    // El pinpad solo aparece cuando el device es kiosko: tras recargar, se rellena y se guarda.
    await page.goto(`${ORIGIN}/admin/dispositivos`);
    const card2 = page.locator(`[data-testid="admin-device"][data-device-id="${deviceId}"]`);
    await card2.getByTestId("device-pinpad-input").fill("02290357044");
    await card2.getByTestId("device-pinpad-save").click();

    await expect
      .poll(async () => (await deviceRolesAndPinpad(deviceId)).pinpadId)
      .toBe("02290357044");
    const final = await deviceRolesAndPinpad(deviceId);
    expect(final.roles).toContain("kiosko");
  } finally {
    await deleteDevice(deviceId);
  }
});
