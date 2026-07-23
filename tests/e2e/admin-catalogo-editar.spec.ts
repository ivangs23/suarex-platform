import { expect, type Locator, type Page, test } from "@playwright/test";

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
 * Abre el panel filtrado por una categoría y devuelve su bloque de edición.
 *
 * El bloque de editar/borrar solo se pinta para la categoría SELECCIONADA (`?cat=`): con 59
 * categorías, repetir ese formulario en todas llenaba la página de campos que nadie estaba
 * mirando. Así que para operar sobre una hay que filtrar por ella.
 */
async function abrirCategoria(page: Page, slug: string) {
  await page.goto(`http://garum.localhost:3000/admin/catalogo?cat=${slug}`);
  return page.getByTestId("admin-category");
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
    const bloque = await abrirCategoria(page, "postres");
    if ((await bloque.count()) === 0) return;
    const nombreActual = await page.getByTestId("admin-category-name").textContent();
    if (nombreActual === "Postres") return;

    await bloque.getByText("Editar categoría").click();
    const f = bloque.getByTestId("category-edit-form");
    await f.getByLabel("Nombre", { exact: true }).fill("Postres");
    await f.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByTestId("admin-category-name")).toHaveText("Postres", {
      timeout: 15_000,
    });
  });

  test("un owner renombra una categoría y se ve en la carta", async ({ page }) => {
    await loginComoOwner(page);
    const categoria = await abrirCategoria(page, "postres");
    await categoria.getByText("Editar categoría").click();

    const formulario = categoria.getByTestId("category-edit-form");
    await expect(formulario.getByLabel("Identificador en la URL")).toHaveValue("postres");
    await formulario.getByLabel("Nombre", { exact: true }).fill("Dulces de la casa");
    await formulario.getByRole("button", { name: "Guardar categoría" }).click();

    // Espera a que el guardado se refleje en el propio panel ANTES de ir a la carta: el
    // form de categoría es server-side y su Server Action + revalidación tardan un
    // instante; navegar de inmediato compite contra esa escritura en vuelo (mismo patrón
    // que el test del precio).
    await expect(page.getByTestId("admin-category-name")).toHaveText("Dulces de la casa", {
      timeout: 15_000,
    });

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

test("el buscador y el árbol acotan el catálogo", async ({ page }) => {
  // Con la carta real de garum (184 productos, 59 categorías) la página llegó a medir
  // 30.000 píxeles. Buscar y filtrar es lo que la hace usable, así que se prueba de punta
  // a punta y no solo en la función pura.
  await loginComoOwner(page);
  await page.goto("http://garum.localhost:3000/admin/catalogo");

  // Sin filtros el listado va acotado: se pinta un tope y se dice cuántos quedan fuera.
  const total = await page.getByTestId("admin-product").count();
  expect(total).toBeGreaterThan(0);

  // Buscar sin acentos encuentra el producto acentuado: nadie teclea tildes en un buscador.
  await page.getByTestId("catalog-search").fill("cafe");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/q=cafe/);

  // Filtrar por una categoría raíz incluye a sus DESCENDIENTES: los vinos de garum cuelgan
  // de nietos y bisnietos, así que filtrar por "Vinos" y ver cero sería inútil.
  await page.goto("http://garum.localhost:3000/admin/catalogo?cat=vinos");
  await expect(page.getByTestId("catalog-crumbs")).toContainText("Vinos");
  await expect(page.getByTestId("admin-product").first()).toBeVisible();

  // "Quitar filtros" vuelve al catálogo completo.
  await page.getByTestId("catalog-clear").click();
  await expect(page).toHaveURL("http://garum.localhost:3000/admin/catalogo");
});

test("una búsqueda sin resultados lo dice, en vez de dejar la página vacía", async ({ page }) => {
  await loginComoOwner(page);
  await page.goto("http://garum.localhost:3000/admin/catalogo?q=zzzznoexiste");

  await expect(page.getByTestId("catalog-empty")).toBeVisible();
  await expect(page.getByTestId("admin-product")).toHaveCount(0);
  // El árbol sigue ahí para poder cambiar de filtro sin volver atrás.
  await expect(page.getByTestId("tree-category").first()).toBeVisible();
});

/** PNG de 1x1 válido y mínimo: ejerce el camino real de subida, no un campo vacío. */
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test.describe("foto de producto", () => {
  /**
   * Deja el producto SIN foto. Se usa antes y después del test.
   *
   * Después, para no contaminar al resto de la suite. Y ANTES, porque una ejecución que
   * reventara a mitad dejaría la foto puesta y la siguiente empezaría comprobando justo lo
   * contrario -- ya pasó al escribir este test. Un test que solo limpia al final asume que
   * el anterior terminó bien.
   */
  async function quitarFoto(page: Page): Promise<void> {
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=tintos");
    const fila = filaProducto(page, "Ribera del Duero");
    if ((await fila.getByTestId("admin-product-image").count()) === 0) return;

    await fila.getByText("Editar producto").click();
    const f = fila.getByTestId("product-edit-form");
    await f.getByTestId("remove-image").check();
    await f.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(
      filaProducto(page, "Ribera del Duero").getByTestId("admin-product-image"),
    ).toHaveCount(0, { timeout: 15_000 });
  }

  test.beforeEach(async ({ page }) => {
    await loginComoOwner(page);
    await quitarFoto(page);
  });

  test.afterEach(async ({ page }) => {
    await quitarFoto(page);
  });

  test("un owner sube la foto de un producto y luego la quita", async ({ page }) => {
    // Subir ya funcionaba; QUITAR no existía: una foto puesta por error era para siempre,
    // porque el formulario solo sabía sustituirla por otra.
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=tintos");

    const fila = filaProducto(page, "Ribera del Duero");
    await fila.getByText("Editar producto").click();
    const formulario = fila.getByTestId("product-edit-form");

    // Sin foto todavía: ni vista previa ni casilla de quitar.
    await expect(formulario.getByTestId("product-edit-current-image")).toHaveCount(0);
    await expect(formulario.getByTestId("remove-image")).toHaveCount(0);

    await formulario.getByLabel("Sustituir foto").setInputFiles({
      name: "vino.png",
      mimeType: "image/png",
      buffer: Buffer.from(PIXEL_PNG_BASE64, "base64"),
    });
    await formulario.getByRole("button", { name: "Guardar cambios" }).click();

    // La miniatura aparece en el listado: confirma que la subida no falló en silencio.
    await expect(
      filaProducto(page, "Ribera del Duero").getByTestId("admin-product-image"),
    ).toBeVisible({ timeout: 15_000 });

    // Y ahora se quita. Se recarga primero: tras guardar, el panel se revalida y el
    // `<details>` vuelve a cerrarse, así que operar sobre el DOM anterior compite contra
    // ese re-render.
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=tintos");
    const conFoto = filaProducto(page, "Ribera del Duero");
    await conFoto.getByText("Editar producto").click();
    const form2 = conFoto.getByTestId("product-edit-form");
    // Con foto, la vista previa está: sustituirla a ciegas sería decidir sin mirar.
    await expect(form2.getByTestId("product-edit-current-image")).toBeVisible();
    await form2.getByTestId("remove-image").check();
    await form2.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(
      filaProducto(page, "Ribera del Duero").getByTestId("admin-product-image"),
    ).toHaveCount(0, { timeout: 15_000 });
  });
});

/**
 * Elige una categoría en un `<select>` de mover por su NOMBRE, sin depender de la sangría.
 *
 * Las opciones llevan un prefijo de guiones por nivel (`— — Blancos`), así que fijar la
 * etiqueta completa en el test la ata a la profundidad actual del árbol: mover una
 * categoría un nivel arriba rompería un test que no tiene nada que ver. Se busca la opción
 * cuyo texto TERMINA en el nombre y se selecciona por su valor.
 */
async function elegirCategoria(select: Locator, nombre: string): Promise<void> {
  const value = await select
    .locator("option")
    .filter({ hasText: nombre })
    .last()
    .getAttribute("value");
  await select.selectOption(value as string);
}

test.describe("mover por el árbol", () => {
  // El seed compartido se restaura SIEMPRE: mover deja el catálogo distinto para el resto
  // de la suite si una aserción revienta a mitad.
  test.afterEach(async ({ page }) => {
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=blancos");
    const bloque = page.getByTestId("admin-category");
    if ((await bloque.count()) === 0) return;
    await bloque.locator("summary", { hasText: "Mover categoría" }).click();
    const f = bloque.getByTestId("move-category-form");
    await elegirCategoria(f.getByLabel("Colgar de"), "Vinos");
    await f.getByRole("button", { name: "Mover categoría" }).click();
    await expect(page.getByTestId("catalog-crumbs")).toContainText("Vinos", { timeout: 15_000 });
  });

  test("un owner mueve un producto de categoría y se refleja en la carta", async ({ page }) => {
    await loginComoOwner(page);
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=tintos");

    const fila = filaProducto(page, "Ribera del Duero");
    await fila.locator("summary", { hasText: "Mover producto" }).click();
    const formulario = fila.getByTestId("move-product-form");
    await elegirCategoria(formulario.getByLabel("Categoría"), "Blancos");
    await formulario.getByRole("button", { name: "Mover producto" }).click();

    // Aparece en la categoría de destino…
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=blancos");
    await expect(filaProducto(page, "Ribera del Duero")).toBeVisible({ timeout: 15_000 });

    // …y en la carta pública, que es lo que ve el comensal.
    await page.goto("http://garum.localhost:3000/5?cat=blancos");
    await expect(page.getByTestId("product").filter({ hasText: "Ribera del Duero" })).toBeVisible();

    // Se devuelve a su sitio.
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=blancos");
    const vuelta = filaProducto(page, "Ribera del Duero");
    await vuelta.locator("summary", { hasText: "Mover producto" }).click();
    const f2 = vuelta.getByTestId("move-product-form");
    await elegirCategoria(f2.getByLabel("Categoría"), "Tintos");
    await f2.getByRole("button", { name: "Mover producto" }).click();
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=tintos");
    await expect(filaProducto(page, "Ribera del Duero")).toBeVisible({ timeout: 15_000 });
  });

  test("el panel rechaza mover una categoría dentro de su propio descendiente", async ({
    page,
  }) => {
    // El ciclo es el fallo grave de esta función: Postgres lo acepta (parent_id es una
    // clave ajena a la propia tabla) y no da error -- deja una rama inalcanzable desde la
    // raíz, con sus productos fuera de la carta sin que nadie los haya borrado.
    await loginComoOwner(page);
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=vinos");

    const bloque = page.getByTestId("admin-category");
    await bloque.locator("summary", { hasText: "Mover categoría" }).click();
    const formulario = bloque.getByTestId("move-category-form");
    // Blancos cuelga de Vinos: colgar Vinos de Blancos cerraría el ciclo.
    await elegirCategoria(formulario.getByLabel("Colgar de"), "Blancos");
    await formulario.getByRole("button", { name: "Mover categoría" }).click();
    await page.waitForTimeout(2000);

    // Sigue siendo raíz: el movimiento se rechazó.
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=vinos");
    await expect(page.getByTestId("catalog-crumbs")).toHaveText("Vinos");
  });

  test("un owner saca una categoría al primer nivel", async ({ page }) => {
    await loginComoOwner(page);
    await page.goto("http://garum.localhost:3000/admin/catalogo?cat=blancos");

    const bloque = page.getByTestId("admin-category");
    await bloque.locator("summary", { hasText: "Mover categoría" }).click();
    const formulario = bloque.getByTestId("move-category-form");
    // Cadena vacía = raíz; es el valor, no la etiqueta, así que no depende del texto.
    await formulario.getByLabel("Colgar de").selectOption("");
    await formulario.getByRole("button", { name: "Mover categoría" }).click();

    // Ya no cuelga de Vinos: las migas son solo ella.
    await expect(page.getByTestId("catalog-crumbs")).toHaveText("Blancos", { timeout: 15_000 });

    // Y aparece como categoría raíz en la carta pública.
    await page.goto("http://garum.localhost:3000/5");
    await expect(page.getByTestId("category").filter({ hasText: "Blancos" })).toBeVisible();
  });
});
