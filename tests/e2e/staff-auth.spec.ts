import { expect, test } from "@playwright/test";

// Requiere que el personal demo ya esté sembrado (`pnpm seed:staff`, ver
// README). Nunca hardcodeamos la contraseña en el repo: `pnpm seed:staff`
// genera una aleatoria cuando no le pasas `STAFF_SEED_PASSWORD` y la guarda en
// `.env.test` (gitignorado) -- `playwright.config.ts` carga ese mismo fichero
// (igual que `vitest.config.ts`), así que en un `pnpm test:e2e` normal esta
// variable ya está puesta sin que nadie exporte nada a mano.
const STAFF_PASSWORD = process.env.STAFF_SEED_PASSWORD;

test.beforeAll(() => {
  // Deliberadamente un fallo, no un `test.skip`: un test saltado es
  // indistinguible de uno que pasa en un resumen de CI/local -- exactamente
  // el defecto que esta suite existe para no repetir. Si esto revienta,
  // significa que nadie sembró personal en absoluto en este stack (p. ej.
  // tras `supabase db reset` sin volver a correr `pnpm seed:staff`), y el
  // mensaje lo dice explícitamente en vez de dejar pasar la suite en verde.
  expect(
    STAFF_PASSWORD,
    "Falta STAFF_SEED_PASSWORD: no hay personal sembrado en este stack. Corre " +
      "`pnpm seed:staff` (ver README) y vuelve a lanzar `pnpm test:e2e`.",
  ).toBeTruthy();
});

/**
 * Login real a través del formulario de `/staff/login`, no una cookie
 * fabricada a mano: es precisamente la superficie que falló en el defecto
 * original (el cliente de navegador guardaba la sesión en localStorage; el
 * servidor la leía de cookies -- nunca se encontraban).
 */
async function loginAsStaff(
  page: import("@playwright/test").Page,
  host: string,
  email: string,
): Promise<void> {
  await page.goto(`http://${host}:3000/staff/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(STAFF_PASSWORD as string);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test.describe("autenticación de personal", () => {
  test("login real deja al personal en /staff y la sesión sobrevive a un reload", async ({
    page,
  }) => {
    await loginAsStaff(page, "garum.localhost", "staff@garum.local");

    // Punto 2: aterriza en /staff y se QUEDA -- si el cliente de navegador no
    // escribe cookies que el servidor pueda leer, esto redirige de vuelta a
    // /staff/login en bucle (el defecto original). Timeout generoso a
    // propósito: bajo `pnpm test:e2e` con varios workers en paralelo, esta es
    // la primera visita a /staff/login y /staff, así que el dev server de
    // Next (webpack, no Turbopack -- ver next.config.ts) puede tardar en
    // compilarlas bajo carga; no es parte del comportamiento que este test
    // verifica.
    await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });
    await expect(page.getByTestId("staff-tenant")).toHaveText("garum");

    // Punto 3, el que de verdad habría atrapado el defecto: recargar es una
    // petición de servidor nueva de cero, sin nada de estado de React/localStorage
    // superviviente en memoria. Si la sesión solo vivía en localStorage, el
    // servidor no la ve tras el reload y esto redirige a /staff/login.
    await page.reload();
    await expect(page).toHaveURL("http://garum.localhost:3000/staff");
    await expect(page.getByTestId("staff-tenant")).toHaveText("garum");
  });

  test("una sesión de personal de un tenant se rechaza en el Host de otro tenant", async ({
    page,
    context,
  }) => {
    await loginAsStaff(page, "garum.localhost", "staff@garum.local");
    await expect(page.getByTestId("staff-tenant")).toHaveText("garum");

    // Las cookies de sesión de @supabase/ssr son host-only (sin atributo
    // Domain): el navegador nunca las habría enviado a manuela.localhost por
    // sí solo. Para probar de verdad el invariante de resolveStaffSession (no
    // solo "sin cookie, sin sesión"), copiamos la sesión VÁLIDA de garum al
    // Host de manuela a propósito -- así se ve si el servidor confía en
    // "¿hay sesión?" o de verdad comprueba "¿el tenant_id del claim coincide
    // con el tenant resuelto por Host?" (ver docstring de resolveStaffSession).
    const garumCookies = await context.cookies("http://garum.localhost:3000");
    const authCookies = garumCookies.filter((cookie) => cookie.name.startsWith("sb-"));
    expect(
      authCookies.length,
      "no se encontró ninguna cookie de sesión de Supabase",
    ).toBeGreaterThan(0);

    await context.addCookies(
      authCookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: "manuela.localhost",
        path: cookie.path,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      })),
    );

    await page.goto("http://manuela.localhost:3000/staff");

    // Mismatch de tenant: `resolveStaffSession` debe fallar cerrado exactamente
    // igual que "sin sesión" -- redirige a /staff/login, nunca sirve el panel
    // de otro tenant.
    await expect(page).toHaveURL("http://manuela.localhost:3000/staff/login");
    await expect(page.getByTestId("staff-tenant")).toHaveCount(0);
  });
});
