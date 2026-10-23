import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { revalidarCarta } from "./carta-cache.js";

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
 * Cliente de servicio EXCLUSIVO de los specs del panel de catálogo (`admin-catalogo*.spec.ts`),
 * para dejar el catálogo sembrado como estaba: borrar, por su propio id, exactamente la
 * categoría que un test creó, o devolver a su sitio un producto que movió -- mismo
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
  const { data } = await admin
    .from("categories")
    .select("tenant_id")
    .eq("id", categoryId)
    .maybeSingle();
  const { error } = await admin.from("categories").delete().eq("id", categoryId);
  if (error) throw error;
  if (data) await revalidarCarta(data.tenant_id as string);
}

/** Devuelve un producto sembrado a su categoría, pase lo que pase en el test que lo movió. */
export async function moverProductoParaTest(
  tenantSlug: string,
  productoEs: string,
  categoriaSlug: string,
): Promise<void> {
  const { data: tenant, error: te } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();
  if (te) throw te;
  const { data: categoria, error: ce } = await admin
    .from("categories")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("slug", categoriaSlug)
    .single();
  if (ce) throw ce;
  const { error } = await admin
    .from("products")
    .update({ category_id: categoria.id })
    .eq("tenant_id", tenant.id)
    .eq("name_i18n->>es", productoEs);
  if (error) throw error;
  await revalidarCarta(tenant.id as string);
}
