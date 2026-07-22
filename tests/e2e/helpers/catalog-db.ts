import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = process.env.SUPABASE_URL;
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!rawUrl || !rawServiceKey) {
  throw new Error(
    "Faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en .env.test. Corre `pnpm db:env`.",
  );
}

const url: string = rawUrl;
const serviceKey: string = rawServiceKey;

/**
 * Cliente de servicio EXCLUSIVO de `tests/e2e/admin-catalogo.spec.ts`, con un único
 * trabajo: borrar, por su propio id, exactamente la categoría que ESE test creó -- mismo
 * patrón que `tests/e2e/helpers/orders-db.ts` usa para `staff-board.spec.ts`.
 *
 * Por qué hace falta esto en vez de confiar en el borrado inline al final del test: si
 * cualquier aserción anterior de ese test falla (p. ej. el render en la carta pública
 * tarda de más), Playwright aborta la función de test ANTES de llegar al bloque de
 * "Limpieza" -- la categoría (y su producto, con imagen en Storage) se quedan en el
 * tenant `garum`, compartido con el resto de la suite (`workers: 1` en
 * `playwright.config.ts`), y eso rompe `two-tenants.spec.ts` ("exactamente el único
 * producto sembrado") en la siguiente ejecución. Un test es dueño de la categoría que
 * crea y la borra desde un `afterEach`, pase lo que pase durante el test.
 */
const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Borra la categoría por id. `products`/`product_extras` caen en cascada (`on delete
 * cascade` sobre `category_id`/`product_id`, ver `20260721000002_catalog.sql`), así que
 * este único delete basta -- el mismo efecto que produce el botón "Borrar categoría" del
 * propio panel (`deleteCategoryAction`), pero sin depender de que la página siga en un
 * estado desde el que se pueda hacer clic.
 *
 * No lanza si la categoría ya no existe (p. ej. el propio test ya la borró desde la UI
 * antes de que corriera este `afterEach`, o el test falló antes de llegar a crearla):
 * `delete().eq(...)` sobre cero filas no es un error en PostgREST, así que no hace falta
 * distinguir ese caso a mano.
 */
export async function deleteCategoryForTest(categoryId: string): Promise<void> {
  const { error } = await admin.from("categories").delete().eq("id", categoryId);
  if (error) throw error;
}
