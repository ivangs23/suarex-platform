import { expect, type Page, test } from "@playwright/test";

/**
 * FRANJAS HORARIAS DE CARTA.
 *
 * Un local con dos servicios no quiere que a las 13:00 se vean los desayunos. La franja vive en
 * la CATEGORÍA, y la herencia -- que una subcategoría dentro de un padre fuera de hora también
 * se oculte -- es lo que este test fija de punta a punta: la lógica pura ya está cubierta en
 * `packages/db/src/franjas.test.ts`, pero que el panel la guarde y la carta la respete solo se
 * ve recorriendo las dos superficies.
 */

const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

test.beforeAll(() => {
  // Un fallo explícito, no un skip: en un resumen de CI un test saltado es indistinguible de
  // uno que pasa. Mismo criterio que `admin-catalogo.spec.ts`.
  expect(
    OWNER_PASSWORD,
    "Falta OWNER_SEED_PASSWORD: no hay owner demo sembrado en este stack. Corre " +
      "`pnpm seed:staff` y vuelve a lanzar `pnpm test:e2e`.",
  ).toBeTruthy();
});

async function loginComoOwner(page: Page): Promise<void> {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@garum.local");
  await page.getByLabel("Contraseña", { exact: true }).fill(OWNER_PASSWORD as string);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });
}

/**
 * Una franja de una hora que empieza dentro de DOS, en la hora del local. Se calcula en vez de
 * fijarla ("03:00-04:00") porque un test que solo pasa de día es un test que alguien verá
 * romperse de madrugada sin haber tocado nada.
 */
function franjaQueNoEsAhora(): { desde: string; hasta: string } {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hora = Number(partes.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const dosDosPuntos = (h: number) => String(h % 24).padStart(2, "0");
  return { desde: `${dosDosPuntos(hora + 2)}:00`, hasta: `${dosDosPuntos(hora + 3)}:00` };
}

/** Guarda la franja de `vinos` (vacías las dos = se ofrece siempre) y espera a que cuaje. */
async function guardarFranja(page: Page, desde: string, hasta: string): Promise<void> {
  await page.goto("http://garum.localhost:3000/admin/catalogo?cat=vinos");
  const categoria = page.getByTestId("admin-category");
  await categoria.getByText("Editar categoría").click();

  const formulario = categoria.getByTestId("category-edit-form");
  await formulario.getByLabel("Desde").fill(desde);
  await formulario.getByLabel("Hasta").fill(hasta);
  await formulario.getByRole("button", { name: "Guardar categoría" }).click();

  // Se espera sobre la FRASE, que la pinta el servidor tras la revalidación, y no sobre el
  // valor de los campos, que ya lleva lo que acabamos de teclear y da por bueno el guardado
  // antes de que ocurra. Con esa espera falsa, la carta se visitaba con la escritura aún en
  // vuelo: `page.goto` pinta UNA vez, así que el HTML antiguo se quedaba fijo y la aserción
  // agotaba su timeout contra un DOM que ya nunca iba a cambiar.
  const esperado = desde ? `Se ofrece de ${desde} a ${hasta}` : "Se ofrece siempre.";
  await expect(
    page.getByTestId("admin-category-franja"),
    "el panel debe releer la franja recién guardada",
  ).toContainText(esperado, { timeout: 15_000 });
}

test("fuera de su franja, una categoría y sus hijas desaparecen de la carta", async ({ page }) => {
  await loginComoOwner(page);
  const { desde, hasta } = franjaQueNoEsAhora();

  try {
    await guardarFranja(page, desde, hasta);

    await page.goto("http://garum.localhost:3000/5?ver=carta");
    await expect(
      page.getByTestId("category").filter({ hasText: "Vinos" }),
      "la categoría con franja no toca ahora",
    ).toHaveCount(0, { timeout: 15_000 });

    // La HERENCIA: `tintos` no tiene franja propia, pero cuelga de `vinos`. Sin esto, sus
    // productos seguirían siendo pedibles entrando por la URL de la subcategoría -- fuera de
    // la carta a efectos de navegación, pero vendibles.
    await page.goto("http://garum.localhost:3000/5?ver=carta&cat=tintos");
    await expect(
      page.getByTestId("product").filter({ hasText: "Ribera del Duero" }),
      "una hija dentro de un padre fuera de hora tampoco se ofrece",
    ).toHaveCount(0, { timeout: 15_000 });
  } finally {
    // Se restaura pase lo que pase: el resto de la suite comparte esta única carta sembrada, y
    // dejar "Vinos" oculta haría fallar tests de ficheros que no han tocado nada.
    await guardarFranja(page, "", "");
  }

  await page.goto("http://garum.localhost:3000/5?ver=carta");
  await expect(
    page.getByTestId("category").filter({ hasText: "Vinos" }),
    "sin franja vuelve a ofrecerse siempre",
  ).toBeVisible({ timeout: 15_000 });
});
