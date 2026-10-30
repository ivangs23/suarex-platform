import { expect, test } from "@playwright/test";
import { tokensDe } from "./helpers/auth-tokens";

/**
 * `/api/sesion`, como la usa la app de escritorio: entra en Auth con la contraseña, entrega aquí
 * los tokens y abre las páginas de la web con esa sesión. Lo que de verdad se prueba es que las
 * cookies que escribe la ruta son las que lee `/staff`; con Auth simulado no se vería.
 */

const STAFF_PASSWORD = process.env.STAFF_SEED_PASSWORD;
const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

const GARUM = "http://garum.localhost:3000";
const MANUELA = "http://manuela.localhost:3000";

test.beforeAll(() => {
  expect(
    STAFF_PASSWORD && OWNER_PASSWORD,
    "Faltan las contraseñas del personal demo en .env.test. Corre `pnpm seed:staff`.",
  ).toBeTruthy();
});

test.describe("sesión de la app de escritorio", () => {
  test("los tokens abren /staff con esa sesión, y DELETE la cierra", async ({ page }) => {
    const tokens = await tokensDe("staff@garum.local", STAFF_PASSWORD as string);

    const abrir = await page.request.post(`${GARUM}/api/sesion`, { data: tokens });
    expect(abrir.status()).toBe(200);
    expect(await abrir.json()).toEqual({ rol: "staff", email: "staff@garum.local" });

    // Primera visita a /staff de la suite en muchos casos: el dev server compila. Ver staff-auth.
    await page.goto(`${GARUM}/staff`);
    await expect(page).toHaveURL(`${GARUM}/staff`, { timeout: 15_000 });
    await expect(page.getByTestId("staff-tenant")).toHaveText("garum");
    expect((await page.request.get(`${GARUM}/api/sesion`)).status()).toBe(200);

    expect((await page.request.delete(`${GARUM}/api/sesion`)).status()).toBe(204);
    expect((await page.request.get(`${GARUM}/api/sesion`)).status()).toBe(401);
    await page.goto(`${GARUM}/staff`);
    await expect(page).toHaveURL(/\/staff\/login/);
  });

  test("con la cuenta del dueño se llega a la gestión", async ({ page }) => {
    const tokens = await tokensDe("owner@garum.local", OWNER_PASSWORD as string);

    const abrir = await page.request.post(`${GARUM}/api/sesion`, { data: tokens });
    expect(await abrir.json()).toEqual({ rol: "owner", email: "owner@garum.local" });

    await page.goto(`${GARUM}/admin/catalogo`);
    await expect(page).toHaveURL(`${GARUM}/admin/catalogo`, { timeout: 15_000 });
    await page.request.delete(`${GARUM}/api/sesion`);
  });

  test("una cuenta de otro negocio no abre sesión ni deja cookies", async ({ page }) => {
    const tokens = await tokensDe("owner@garum.local", OWNER_PASSWORD as string);

    const abrir = await page.request.post(`${MANUELA}/api/sesion`, { data: tokens });
    expect(abrir.status()).toBe(401);
    expect((await page.request.get(`${MANUELA}/api/sesion`)).status()).toBe(401);
  });

  test("un formulario de otra web no puede abrirla", async ({ page }) => {
    const tokens = await tokensDe("staff@garum.local", STAFF_PASSWORD as string);

    const abrir = await page.request.post(`${GARUM}/api/sesion`, {
      headers: { "content-type": "text/plain" },
      data: JSON.stringify(tokens),
    });
    expect(abrir.status()).toBe(400);
    expect((await page.request.get(`${GARUM}/api/sesion`)).status()).toBe(401);
  });
});
