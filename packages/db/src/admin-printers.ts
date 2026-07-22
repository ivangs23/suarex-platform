import { tenantScoped } from "./client.js";

export type PrinterDestination = "cocina" | "barra" | "all";

/**
 * Conexión de una impresora: RED (`type: "network"`, host + puerto TCP directo al
 * dispositivo, normalmente puerto 9100 RAW/JetDirect) o USB (`type: "usb"`, `printerName`
 * tal como aparece en Windows). El caller compone el descriptor (`buildConnection` lo
 * valida por tipo); un `type` desconocido lo rechaza `buildConnection`.
 */
export type PrinterConnection =
  | { type: "network"; host: string; port: number }
  | { type: "usb"; printerName: string };

/** Descriptor de conexión que recibe el repositorio (lo compone la Server Action a partir
 * del formulario). Misma forma que `PrinterConnection`; se valida en `buildConnection`. */
export type PrinterConnectionInput = PrinterConnection;

export type CreatePrinterInput = {
  venueId: string;
  name: string;
  connection: PrinterConnectionInput;
  destination?: PrinterDestination;
  deviceId?: string;
  isDefault?: boolean;
  enabled?: boolean;
};

export type UpdatePrinterInput = Partial<{
  venueId: string;
  name: string;
  connection: PrinterConnectionInput;
  destination: PrinterDestination;
  deviceId: string | null;
  isDefault: boolean;
  enabled: boolean;
}>;

export type PrinterRow = {
  id: string;
  tenantId: string;
  venueId: string;
  deviceId: string | null;
  name: string;
  connection: PrinterConnection;
  destination: PrinterDestination;
  isDefault: boolean;
  enabled: boolean;
};

/**
 * Validación "de verdad" de la conexión de red: vive AQUÍ, en el repositorio, no solo en
 * la Server Action (`apps/web/app/admin/impresoras/actions.ts`) -- mismo razonamiento que
 * `resolveTtlMinutes` en `admin-devices.ts` y `assertValidPrice` en `admin-catalog.ts`:
 * cualquier caller futuro que no pase por esa action (un script, otra action) queda
 * protegido igual, sin depender de que se acuerde de revalidar.
 *
 * `host`: no vacío tras `trim()` -- un host en blanco no identifica ninguna impresora.
 * `port`: entero en 1..65535 (rango válido de un puerto TCP; 0 no es un puerto usable).
 * `Number.isInteger` rechaza a la vez `NaN`, `Infinity` y cualquier decimal no entero
 * ("abc" convertido con `Number(...)` en la capa de la action llega aquí como `NaN`, que
 * `Number.isInteger` rechaza igual que un `70000` fuera de rango).
 */
function buildNetworkConnection(host: string, port: number): PrinterConnection {
  if (host.trim() === "") {
    throw new Error("host inválido: no puede estar vacío");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`port inválido (se esperaba un entero entre 1 y 65535): ${port}`);
  }
  return { type: "network", host, port };
}

/** Validación de la conexión USB: `printerName` no vacío tras `trim()` (un nombre en blanco
 * no identifica ninguna impresora de Windows). Análogo de `buildNetworkConnection`. */
export function buildUsbConnection(printerName: string): PrinterConnection {
  if (printerName.trim() === "") {
    throw new Error("printerName inválido: no puede estar vacío");
  }
  return { type: "usb", printerName };
}

/** Despacha por tipo al validador correspondiente. Un tipo desconocido se rechaza. */
function buildConnection(input: PrinterConnectionInput): PrinterConnection {
  if (input.type === "network") return buildNetworkConnection(input.host, input.port);
  if (input.type === "usb") return buildUsbConnection(input.printerName);
  throw new Error(`tipo de conexión no soportado: ${(input as { type: string }).type}`);
}

/**
 * Crea una impresora de red. `venueId` que pertenezca a otro tenant, o un `deviceId` (si
 * se indica) que pertenezca a otro tenant, los rechaza el trigger `assert_same_tenant`
 * (`20260722000001_devices_printers.sql`), no una comprobación en esta capa -- mismo
 * patrón que `createDevice`/`createTable`: este repositorio confía en que la base rechace
 * la referencia cruzada y se limita a propagar el error de Postgres tal cual
 * (`cross-tenant reference rejected`).
 */
export async function createPrinter(
  tenantId: string,
  input: CreatePrinterInput,
): Promise<{ id: string }> {
  const connection = buildConnection(input.connection);

  const { data, error } = await tenantScoped("printers", tenantId)
    .insert({
      venue_id: input.venueId,
      device_id: input.deviceId ?? null,
      name: input.name,
      connection,
      destination: input.destination ?? "cocina",
      is_default: input.isDefault ?? false,
      enabled: input.enabled ?? true,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string };
}

/**
 * `host`/`port` viajan sueltos en `UpdatePrinterInput` (no como un `connection` ya
 * compuesto) para que quien llame no tenga que conocer la forma interna de la columna
 * `jsonb` -- misma idea que `CreatePrinterInput`. Como la columna guarda el objeto
 * `connection` completo (no columnas `host`/`port` separadas), cambiar solo uno de los
 * dos sin el otro dejaría la reconstrucción del objeto ambigua (¿de dónde sale el valor
 * que no se manda: se conserva el actual, con una lectura previa, o se rechaza?). Se opta
 * por rechazar: si se quiere tocar la conexión, `host` y `port` se mandan juntos, sin
 * necesidad de leer la fila actual primero.
 */
export async function updatePrinter(
  tenantId: string,
  printerId: string,
  patch: UpdatePrinterInput,
): Promise<void> {
  const values: Record<string, unknown> = {};
  if (patch.venueId !== undefined) values.venue_id = patch.venueId;
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.destination !== undefined) values.destination = patch.destination;
  if (patch.deviceId !== undefined) values.device_id = patch.deviceId;
  if (patch.isDefault !== undefined) values.is_default = patch.isDefault;
  if (patch.enabled !== undefined) values.enabled = patch.enabled;

  if (patch.connection !== undefined) {
    values.connection = buildConnection(patch.connection);
  }

  const { error } = await tenantScoped("printers", tenantId).update(values).eq("id", printerId);
  if (error) throw error;
}

export async function deletePrinter(tenantId: string, printerId: string): Promise<void> {
  const { error } = await tenantScoped("printers", tenantId).delete().eq("id", printerId);
  if (error) throw error;
}

type PrinterRowDb = {
  id: string;
  tenant_id: string;
  venue_id: string;
  device_id: string | null;
  name: string;
  connection: PrinterConnection;
  destination: PrinterDestination;
  is_default: boolean;
  enabled: boolean;
};

/** Lectura acotada al tenant para la pantalla de gestión de impresoras (Task 5). */
export async function listPrinters(tenantId: string): Promise<PrinterRow[]> {
  const { data, error } = await tenantScoped("printers", tenantId)
    .select(
      "id, tenant_id, venue_id, device_id, name, connection, destination, is_default, enabled",
    )
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data as PrinterRowDb[]).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    venueId: row.venue_id,
    deviceId: row.device_id,
    name: row.name,
    connection: row.connection,
    destination: row.destination,
    isDefault: row.is_default,
    enabled: row.enabled,
  }));
}
