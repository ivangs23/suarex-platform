import { expect, type Page, test } from "@playwright/test";

/**
 * Edición de catálogo desde el panel.
 *
 * Hasta ahora el panel solo sabía crear y borrar: cambiar el precio de un producto
 * obligaba a borrarlo y recrearlo, perdiendo sus extras y su imagen con el
 * `on delete cascade`. Estos tests fijan que editar funciona Y que NO se lleva por delante
 * lo que no se tocó, que es lo que hacía inaceptable el rodeo anterior.
 */

const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

test.beforeAll(() => {
  // Un fallo explícito, no un skip: en un resumen de CI un test saltado es
  // indistinguible de uno que pasa. Mismo criterio que `admin-catalogo.spec.ts`.
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

/** Fila del panel de un producto sembrado por `supabase/seed.sql`. */
function filaProducto(page: Page, nombre: string) {
  return page.getByTestId("admin-product").filter({ hasText: nombre });
}

/**
 * Bloque del panel de una categoría, localizado por su ENCABEZADO.
 *
 * No vale `filter({ hasText })`: cada formulario de edición de producto lleva un `<select>`
 * con TODAS las categorías, así que el nombre de cualquiera aparece dentro del bloque de
 * todas las demás y el filtro por texto casa de más (lo destapó este mismo test: cuatro
 * coincidencias para "Postres"). El encabezado sí es único por bloque.
 */
function bloqueCategoria(page: Page, nombre: string) {
  return page.getByTestId("admin-category").filter({
    has: page.getByTestId("admin-category-name").filter({ hasText: nombre }),
  });
}

test("un owner cambia el precio de un producto y se refleja en la carta pública", async ({
  page,
}) => {
  await loginComoOwner(page);
  await page.goto("http://garum.localhost:3000/admin/catalogo");

  const fila = filaProducto(page, "Ribera del Duero");
  await fila.getByText("Editar producto").click();

  const formulario = fila.getByTestId("product-edit-form");
  // Prellenado con el valor actual: si el formulario arrancara vacío, guardar sin tocar
  // un campo lo borraría.
  await expect(formulario.getByLabel("Precio (€)")).toHaveValue("18");

  await formulario.getByLabel("Precio (€)").fill("21.50");
  await formulario.getByRole("button", { name: "Guardar cambios" }).click();

  await expect(filaProducto(page, "Ribera del Duero")).toContainText("21,50", {
    timeout: 15_000,
  });

  // Y llega a lo que ve el comensal, que es lo que de verdad importa.
  await page.goto("http://garum.localhost:3000/5?cat=tintos");
  await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toContainText(
    "21,50",
  );

  // Se deja como estaba: esta suite comparte el stack con el resto de ficheros.
  await page.goto("http://garum.localhost:3000/admin/catalogo");
  const vuelta = filaProducto(page, "Ribera del Duero");
  await vuelta.getByText("Editar producto").click();
  await vuelta.getByTestId("product-edit-form").getByLabel("Precio (€)").fill("18");
  await vuelta.getByTestId("product-edit-form").getByRole("button", { name: "Guardar" }).click();
  await expect(filaProducto(page, "Ribera del Duero")).toContainText("18,00", { timeout: 15_000 });
});

test("editar un producto NO borra sus extras", async ({ page }) => {
  // El rodeo anterior (borrar y recrear) se llevaba los extras por delante. Este control
  // es la razón de ser de la edición, no un detalle.
  await loginComoOwner(page);
  await page.goto("http://garum.localhost:3000/admin/catalogo");

  const fila = filaProducto(page, "Ribera del Duero");
  await expect(fila).toContainText("Copa extra");

  await fila.getByText("Editar producto").click();
  const formulario = fila.getByTestId("product-edit-form");
  await formulario.getByLabel("Nombre", { exact: true }).fill("Ribera del Duero");
  await formulario.getByRole("button", { name: "Guardar cambios" }).click();

  await expect(filaProducto(page, "Ribera del Duero")).toContainText("Copa extra", {
    timeout: 15_000,
  });
});

test.describe("renombrar categoría", () => {
  // La restauración va en afterEach, no al final del test: si una aserción revienta a
  // mitad, el nombre original se restaura IGUALMENTE. Sin esto, una ejecución rota deja
  // "Postres" convertido en otra cosa y contamina al resto de la suite (que comparte
  // stack) -- exactamente lo que pasó al escribir este test.
  test.afterEach(async ({ page }) => {
    await page.goto("http://garum.localhost:3000/admin/catalogo");
    const renombrada = bloqueCategoria(page, "Dulces de la casa");
    if ((await renombrada.count()) === 0) return;
    await renombrada.getByText("Editar categoría").click();
    const f = renombrada.getByTestId("category-edit-form");
    await f.getByLabel("Nombre", { exact: true }).fill("Postres");
    await f.getByRole("button", { name: "Guardar" }).click();
    await expect(bloqueCategoria(page, "Postres")).toBeVisible({ timeout: 15_000 });
  });

  test("un owner renombra una categoría y se ve en la carta", async ({ page }) => {
    await loginComoOwner(page);
    await page.goto("http://garum.localhost:3000/admin/catalogo");

    const categoria = bloqueCategoria(page, "Postres");
    await categoria.getByText("Editar categoría").click();

    const formulario = categoria.getByTestId("category-edit-form");
    await expect(formulario.getByLabel("Identificador en la URL")).toHaveValue("postres");
    await formulario.getByLabel("Nombre", { exact: true }).fill("Dulces de la casa");
    await formulario.getByRole("button", { name: "Guardar categoría" }).click();

    // Espera a que el guardado se refleje en el propio panel ANTES de ir a la carta: el
    // form de categoría es server-side y su Server Action + revalidación tardan un
    // instante; navegar de inmediato compite contra esa escritura en vuelo (mismo patrón
    // que el test del precio).
    await expect(bloqueCategoria(page, "Dulces de la casa")).toBeVisible({ timeout: 15_000 });

    await page.goto("http://garum.localhost:3000/5");
    await expect(page.getByTestId("category").filter({ hasText: "Dulces de la casa" })).toBeVisible(
      { timeout: 15_000 },
    );
  });
});

test("un staff no puede editar: el panel ni siquiera se le muestra", async ({ page }) => {
  // Control negativo. `requireManager` es la primera barrera y cada Server Action vuelve a
  // comprobar el rol por su cuenta, así que un staff no llega ni a ver los formularios.
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill("staff@garum.local");
  await page.getByLabel("Contraseña", { exact: true }).fill(process.env.STAFF_SEED_PASSWORD ?? "");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });

  await page.goto("http://garum.localhost:3000/admin/catalogo");
  await expect(page.getByTestId("product-edit-form")).toHaveCount(0);
});
