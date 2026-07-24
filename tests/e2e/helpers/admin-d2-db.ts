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
 * Cliente de servicio EXCLUSIVO de `tests/e2e/admin-d2.spec.ts`, con un único trabajo:
 * borrar, por su propio id, exactamente la mesa/dispositivo/impresora que ESE test creó
 * -- mismo patrón que `tests/e2e/helpers/catalog-db.ts` (`admin-catalogo.spec.ts`) y
 * `tests/e2e/helpers/orders-db.ts` (`staff-board.spec.ts`).
 *
 * Por qué hace falta esto en vez de confiar en el borrado inline al final de cada test:
 * si cualquier aserción anterior falla, Playwright aborta la función de test ANTES de
 * llegar al borrado por UI -- la fila se queda en el tenant `garum`, compartido con el
 * resto de la suite (`workers: 1` en `playwright.config.ts`), ensuciando la siguiente
 * ejecución. Cada test es dueño de lo que crea y lo borra en un `afterEach`, pase lo que
 * pase durante el test (lección de D1, ver brief).
 */
const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** No lanza si la fila ya no existe (p. ej. el propio test ya la borró desde la UI antes
 * de que corriera este `afterEach`): `delete().eq(...)` sobre cero filas no es un error
 * en PostgREST. */
export async function deleteTableForTest(tableId: string): Promise<void> {
  const { error } = await admin.from("tables").delete().eq("id", tableId);
  if (error) throw error;
}

/** `printers.device_id` referencia `devices` con `on delete set null`
 * (`20260722000001_devices_printers.sql`): borrar el dispositivo de prueba nunca deja un
 * `printer_id` huérfano en la base. */
export async function deleteDeviceForTest(deviceId: string): Promise<void> {
  const { error } = await admin.from("devices").delete().eq("id", deviceId);
  if (error) throw error;
}

/**
 * Crea, en el tenant `garum`, un dispositivo con una lista de impresoras ya "reportada" (como
 * si hubiera mandado un heartbeat), para probar que el panel admin ofrece el desplegable (#7)
 * sin tener que arrancar un agente real. Devuelve el id para borrarlo en el `afterEach`.
 */
export async function createDeviceWithPrintersForTest(
  name: string,
  printers: string[],
): Promise<string> {
  const { data: tenant, error: te } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", "garum")
    .single();
  if (te) throw te;
  const { data: venue, error: ve } = await admin
    .from("venues")
    .select("id")
    .eq("tenant_id", tenant.id as string)
    .order("is_default", { ascending: false })
    .limit(1)
    .single();
  if (ve) throw ve;
  const { data: device, error: de } = await admin
    .from("devices")
    .insert({ tenant_id: tenant.id, venue_id: venue.id, name, printers })
    .select("id")
    .single();
  if (de) throw de;
  return device.id as string;
}

export async function deletePrinterForTest(printerId: string): Promise<void> {
  const { error } = await admin.from("printers").delete().eq("id", printerId);
  if (error) throw error;
}
