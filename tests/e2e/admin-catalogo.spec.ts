import { expect, type Page, test } from "@playwright/test";
import { deleteCategoryForTest } from "./helpers/catalog-db.js";

// Igual que `tests/e2e/staff-auth.spec.ts`: requiere que el personal demo Y el owner
// demo ya estén sembrados (`pnpm seed:staff`, ver README). Nunca hardcodeamos ninguna
// contraseña en el repo -- `pnpm seed:staff` genera una aleatoria por rol cuando no le
// pasas `STAFF_SEED_PASSWORD`/`OWNER_SEED_PASSWORD` y las guarda en `.env.test`
// (gitignorado); `playwright.config.ts` carga ese mismo fichero, así que en un
// `pnpm test:e2e` normal ambas variables ya están puestas sin que nadie exporte nada a
// mano.
const STAFF_PASSWORD = process.env.STAFF_SEED_PASSWORD;
const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

test.beforeAll(() => {
  // Deliberadamente un fallo, no un `test.skip`: un test saltado es indistinguible de
  // uno que pasa en un resumen de CI/local -- el mismo gotcha que `staff-auth.spec.ts`
  // ya cerró para el personal. Si esto revienta, significa que a este stack le falta
  // sembrar personal y/o el owner demo (p. ej. tras `supabase db reset` sin volver a
  // correr `pnpm seed:staff`), y el mensaje lo dice explícitamente en vez de dejar
  // pasar la suite en verde.
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

/** 1x1 PNG válido y mínimo, para ejercer de verdad la subida de imagen
 * (`uploadProductImage`, `packages/db/src/storage.ts`) en el test del owner -- no solo
 * dejar el campo `image` vacío. */
const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/**
 * Id de la categoría creada por el test del owner, capturado en cuanto existe (ver más
 * abajo) para que `test.afterEach` -- que SIEMPRE corre, a diferencia del cuerpo del
 * test si una aserción anterior revienta -- pueda borrarla igualmente. `undefined`
 * mientras no hay nada que limpiar (test del staff, o el propio owner aún no llegó a
 * crear la categoría).
 */
let createdCategoryId: string | undefined;

test.afterEach(async () => {
  if (!createdCategoryId) return;
  const categoryId = createdCategoryId;
  createdCategoryId = undefined;
  try {
    await deleteCategoryForTest(categoryId);
  } catch (error) {
    // No relanzar: un fallo de limpieza no debe enmascarar el fallo real del test (si lo
    // hubo, es lo que Playwright debe reportar) ni tumbar un test que ya había pasado.
    // Se deja constancia en consola para poder investigarlo a mano si hiciera falta.
    console.error(`No se pudo borrar la categoría de prueba ${categoryId}:`, error);
  }
});

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Aterriza en /staff antes de seguir: confirma que el login real (vía Supabase Auth,
  // no una cookie fabricada a mano) dejó una sesión que el servidor reconoce -- mismo
  // punto de control que `staff-auth.spec.ts`.
  await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });
}

test("un staff no ve el panel de gestión", async ({ page }) => {
  await login(page, "staff@garum.local", STAFF_PASSWORD as string);

  await page.goto("http://garum.localhost:3000/admin/catalogo");
  // `requireManager()` rechaza cualquier rol que no sea owner/admin -- un staff
  // autenticado (sesión real, no ausente) es redirigido a /staff/login igual que
  // alguien sin sesión, ver `apps/web/lib/require-manager.ts`.
  await expect(page).toHaveURL(/\/staff\/login/);
  await expect(page.locator("h1")).not.toHaveText("Catálogo");
});

test("un owner crea una categoría y un producto (con imagen), y aparecen en la carta", async ({
  page,
}) => {
  await login(page, "owner@garum.local", OWNER_PASSWORD as string);

  await page.goto("http://garum.localhost:3000/admin/catalogo");
  await expect(page).toHaveURL("http://garum.localhost:3000/admin/catalogo");
  await expect(page.locator("h1")).toHaveText("Catálogo");

  // 1. Crea la categoría "Vinos E2E" (destino barra). El slug lleva un sufijo con
  // timestamp para que el test sea repetible sin chocar contra `unique (tenant_id,
  // slug)` (`20260721000002_catalog.sql`) si se corre varias veces sobre el mismo
  // stack sin `supabase db reset` de por medio. Un único `Date.now()` para categoría,
  // slug y producto (más abajo) -- no una llamada por nombre -- para que los tres
  // sufijos coincidan y sea trivial correlacionarlos/limpiarlos a mano si hiciera falta.
  const testRunId = Date.now();
  const categoryName = `Vinos E2E ${testRunId}`;
  const slug = `vinos-e2e-${testRunId}`;
  await page.locator("summary", { hasText: "Nueva categoría" }).click();
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Nombre de la categoría").fill(categoryName);
  await page.getByLabel("Destino").selectOption("barra");
  await page.getByRole("button", { name: "Crear categoría" }).click();

  // Espera a que la categoría aparezca en el ÁRBOL antes de navegar: la Server Action y su
  // revalidación tardan un instante, y navegar de inmediato compite contra esa escritura en
  // vuelo (el mismo tropiezo que ya cerró `admin-catalogo-editar.spec.ts`).
  await expect(page.getByTestId("tree-category").filter({ hasText: categoryName })).toBeVisible({
    timeout: 15_000,
  });

  // El bloque de una categoría (editar/borrar) solo se pinta cuando está SELECCIONADA:
  // con 59 categorías, repetir ese formulario en todas llenaba la página de campos que
  // nadie estaba mirando. Se navega a su filtro para poder operar sobre ella.
  await page.goto(`http://garum.localhost:3000/admin/catalogo?cat=${slug}`);

  const categoryRow = page.getByTestId("admin-category");
  await expect(categoryRow).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("admin-category-name")).toHaveText(categoryName);

  // Captura el id real de la categoría desde el propio panel (el hidden input que
  // alimenta `deleteCategoryAction`, ver `ConfirmDeleteForm`) -- `createCategoryAction`
  // no devuelve nada (`apps/web/app/admin/catalogo/actions.ts`), así que esta es la única
  // forma de conocerlo sin tocar la base a mano. Guardarlo en la variable de módulo que
  // lee `test.afterEach` (arriba) es lo que permite que la limpieza sobreviva a un fallo
  // de aserción en cualquiera de los pasos siguientes.
  // `.first()`: el bloque de la categoría tiene AHORA dos campos ocultos `category_id`
  // -- el de borrar (`ConfirmDeleteForm`) y el de editar (`CategoryEditForm`) -- con el
  // MISMO valor, así que cualquiera de los dos sirve para capturar el id.
  createdCategoryId = await categoryRow
    .locator('input[type="hidden"][name="category_id"]')
    .first()
    .inputValue();

  // 2. Crea el producto "Ribera" a 18,00 € en esa categoría, con una imagen adjunta --
  // ejerce de verdad el camino de subida (`uploadProductImage`), no solo el campo
  // vacío.
  const productName = `Ribera E2E ${testRunId}`;
  // Los formularios de alta viven plegados en la tarjeta "Añadir": desplegarlo primero.
  await page.locator("summary", { hasText: "Nuevo producto" }).click();
  await page.getByLabel("Categoría", { exact: true }).selectOption({ label: categoryName });
  await page.getByLabel("Nombre del producto").fill(productName);
  await page.getByLabel("Precio del producto (€)").fill("18.00");
  await page.getByLabel("Imagen").setInputFiles({
    name: "vino.png",
    mimeType: "image/png",
    buffer: Buffer.from(PIXEL_PNG_BASE64, "base64"),
  });
  await page.getByRole("button", { name: "Crear producto" }).click();

  // El producto aparece en el propio panel, con el precio formateado en euros y la
  // imagen subida (confirma que la subida no falló en silencio).
  const adminProductRow = page.getByTestId("admin-product").filter({ hasText: productName });
  await expect(adminProductRow).toBeVisible({ timeout: 15_000 });
  await expect(adminProductRow.getByText("18,00")).toBeVisible();
  await expect(adminProductRow.getByTestId("admin-product-image")).toBeVisible();

  // 3. La carta pública real de la mesa 1 -- comprueba que el producto recién creado
  // aparece ahí, no solo en el panel de gestión. Con su categoría: la carta se navega por
  // niveles, y en la raíz un producto no se pinta.
  await page.goto(`http://garum.localhost:3000/1?cat=${slug}`);
  await expect(page.getByTestId("product").filter({ hasText: productName })).toBeVisible({
    timeout: 15_000,
  });

  // Limpieza: 'garum' es el mismo tenant demo que usan otros ficheros de esta suite
  // (p. ej. `two-tenants.spec.ts` asume que su catálogo tiene EXACTAMENTE el único
  // producto sembrado por `supabase/seed.sql`). Borra la categoría recién creada desde
  // el propio panel -- el `on delete cascade` de `20260721000002_catalog.sql` se lleva
  // el producto y su imagen de Storage con ella -- para no dejar el stack sucio para el
  // resto de la suite (`workers: 1` en `playwright.config.ts` hace que esto corra antes
  // que `two-tenants.spec.ts`, pero da igual el orden: cada fichero debe encontrar el
  // catálogo tal como lo dejó `supabase/seed.sql`).
  //
  // Esto es el camino feliz (además ejerce el botón "Borrar categoría" del panel, que
  // ningún otro test de la suite toca); el `test.afterEach` de arriba es la red de
  // seguridad que borra por id directamente en la base si CUALQUIER aserción anterior
  // revienta antes de llegar aquí -- de ahí que se limpie `createdCategoryId` justo
  // después de confirmar que este borrado por UI ya surtió efecto: evita un segundo
  // (inofensivo, pero innecesario) intento de borrado en el `afterEach`.
  // Con su filtro: el bloque de editar/borrar solo existe para la categoría seleccionada.
  await page.goto(`http://garum.localhost:3000/admin/catalogo?cat=${slug}`);
  page.once("dialog", (dialog) => dialog.accept());
  await categoryRow.getByRole("button", { name: "Borrar categoría" }).click();
  // Tras borrarla, su slug ya no resuelve y el panel vuelve a "todas": el bloque
  // desaparece porque no hay categoría seleccionada.
  await expect(categoryRow).toHaveCount(0);
  createdCategoryId = undefined;
});
