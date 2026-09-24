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

export async function deletePrinterForTest(printerId: string): Promise<void> {
  const { error } = await admin.from("printers").delete().eq("id", printerId);
  if (error) throw error;
}

/**
 * Siembra un dispositivo que YA ha reportado su lista de impresoras, más una impresora USB
 * atada a él con un nombre que NO está en esa lista -- el typo que el aviso tiene que cazar.
 *
 * Va por service key y no por la UI porque el panel no tiene (ni debe tener) forma de fingir
 * que un agente ha reportado: eso lo escribe la RPC `device_heartbeat` desde el PC del
 * cliente, y montar un agente falso para un aviso de pantalla sería más máquina que prueba.
 */
export async function seedPrinterNotReportedForTest(reportadas: string[], configurada: string) {
  // Acotado a garum por su tenant: hay más de una sede con el slug "principal" en la base
  // local (garum y manuela), así que filtrar solo por slug devolvería dos filas.
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", "garum")
    .single();
  if (tenantError) throw tenantError;

  const { data: venue, error: venueError } = await admin
    .from("venues")
    .select("id, tenant_id")
    .eq("tenant_id", tenant.id)
    .eq("is_default", true)
    .single();
  if (venueError) throw venueError;

  const { data: device, error: deviceError } = await admin
    .from("devices")
    .insert({
      tenant_id: venue.tenant_id,
      venue_id: venue.id,
      name: `PC E2E ${Date.now()}`,
      reported_printers: reportadas,
    })
    .select("id, name")
    .single();
  if (deviceError) throw deviceError;

  const { data: printer, error: printerError } = await admin
    .from("printers")
    .insert({
      tenant_id: venue.tenant_id,
      venue_id: venue.id,
      device_id: device.id,
      name: `Impresora E2E ${Date.now()}`,
      connection: { type: "usb", printerName: configurada },
      destination: "cocina",
      enabled: true,
    })
    .select("id, name")
    .single();
  if (printerError) throw printerError;

  return {
    deviceId: device.id as string,
    deviceName: device.name as string,
    printerId: printer.id as string,
    printerName: printer.name as string,
  };
}
