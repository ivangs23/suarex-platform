import { randomBytes } from "node:crypto";
import { authAdminForDeviceReset, tenantScoped } from "./client.js";

/** Minutos de validez por defecto de un código de emparejamiento recién generado --
 * intencionadamente corto: es la única prueba de posesión de un instalador sin secretos
 * (ver el CHECK `devices_pairing_code_min_entropy` en
 * `20260722000002_device_pairing_hardening.sql`), así que la ventana en la que puede ser
 * adivinado/forzado antes de caducar debe ser pequeña. 15 minutos alcanza de sobra para
 * que quien instala el agente lo teclee, sin dejarlo expuesto más de lo necesario. */
const DEFAULT_TTL_MINUTES = 15;

/**
 * Fix round 2 (Finding 1, seguridad): tope superior de defensa en profundidad para
 * `ttlMinutes` -- 24 horas. La validación "de verdad" (rechazar, no clampar, un valor no
 * numérico o fuera de rango) vive en el borde de la Server Action
 * (`parsePairingTtlMinutes`, `apps/web/lib/device-action-input.ts`), que es por donde entra
 * cualquier `ttl_minutes` que controle un navegador. Este tope se repite aquí para que
 * CUALQUIER otro caller futuro de este repositorio (un script, otra action que no pase por
 * `parsePairingTtlMinutes`) quede protegido igual, sin depender de que se acuerde de
 * revalidar. Deliberadamente NO se rechaza aquí un `ttlMinutes` negativo o cero: los tests
 * de integración de este repositorio (`tests/integration/admin-devices.test.ts`) pasan
 * `ttlMinutes: -1` a propósito para simular un código ya caducado en el momento de
 * crearse -- un caso de uso interno legítimo que la Server Action nunca expone (ella sí
 * exige un entero positivo). Solo el techo (`> MAX_TTL_MINUTES`) y los valores no finitos
 * (`NaN`/`Infinity`, que antes llegaban tal cual hasta `new Date(NaN).toISOString()` y
 * lanzaban un `RangeError` sin mensaje claro) se rechazan en esta capa.
 */
const MAX_TTL_MINUTES = 24 * 60;

function resolveTtlMinutes(ttlMinutes: number | undefined): number {
  if (ttlMinutes === undefined) return DEFAULT_TTL_MINUTES;
  if (!Number.isFinite(ttlMinutes)) {
    throw new Error(`ttlMinutes inválido (se esperaba un número finito): ${ttlMinutes}`);
  }
  if (ttlMinutes > MAX_TTL_MINUTES) {
    throw new Error(
      `ttlMinutes no puede superar ${MAX_TTL_MINUTES} minutos (24 horas): ${ttlMinutes}`,
    );
  }
  return ttlMinutes;
}

export type CreateDeviceInput = {
  venueId: string;
  name: string;
  ttlMinutes?: number;
};

export type CreateDeviceResult = {
  id: string;
  pairingCode: string;
  expiresAt: string;
};

export type RegeneratePairingCodeResult = {
  pairingCode: string;
  expiresAt: string;
};

export type DeviceRow = {
  id: string;
  tenantId: string;
  venueId: string;
  name: string;
  roles: string[];
  /** SIEMPRE un booleano, nunca el código en sí -- ver el docstring de `listDevices`. */
  hasPendingPairingCode: boolean;
  pairingExpiresAt: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
};

/**
 * Código de emparejamiento: 24 bytes de `crypto.randomBytes` -- no `Math.random()`, no un
 * contador ni un timestamp -- codificados en base64url, lo que da 32 caracteres (~192 bits
 * de entropía; 24 bytes * 8 bits/byte -- fix round 2, Finding 2: la cifra anterior, "~144
 * bits", era incorrecta, ver el comentario de la migración
 * `20260722000002_device_pairing_hardening.sql` para el porqué de que ese comentario NO se
 * haya corregido igual). Muy por encima del suelo de 20 caracteres que impone el CHECK
 * `devices_pairing_code_min_entropy` (esa misma migración), que documenta exactamente esta
 * fórmula como la exigida para el generador real. Es la única defensa de este código frente
 * a que alguien lo adivine o lo fuerce por fuerza bruta antes de que caduque, así que nunca
 * debe debilitarse a una longitud menor o a una fuente no criptográfica.
 */
function generatePairingCode(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Da de alta un dispositivo con un código de emparejamiento fresco. El código se genera
 * aquí, se guarda en `devices.pairing_code`, y se devuelve EN CLARO solo en el valor de
 * retorno de esta llamada -- nunca se registra en logs, nunca se vuelve a leer de la base
 * (`listDevices` deliberadamente no expone `pairing_code`, solo si hay uno pendiente y
 * cuándo caduca). Quien llama (la Server Action del panel, Task 3/5) es responsable de
 * mostrarlo una única vez a quien está instalando el dispositivo.
 *
 * `venueId` que pertenezca a otro tenant lo rechaza el trigger `assert_same_tenant`
 * (misma tabla que `devices`, ver `20260722000001_devices_printers.sql`), no una
 * comprobación en esta capa -- mismo patrón que `createTable`/`createProduct`: este
 * repositorio confía en que la base rechace la referencia cruzada y se limita a propagar
 * el error de Postgres tal cual (`cross-tenant reference rejected`).
 */
export async function createDevice(
  tenantId: string,
  input: CreateDeviceInput,
): Promise<CreateDeviceResult> {
  const pairingCode = generatePairingCode();
  const ttlMinutes = resolveTtlMinutes(input.ttlMinutes);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  const { data, error } = await tenantScoped("devices", tenantId)
    .insert({
      venue_id: input.venueId,
      name: input.name,
      pairing_code: pairingCode,
      pairing_expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw error;

  return { id: data.id as string, pairingCode, expiresAt };
}

/**
 * Sustituye el código de emparejamiento de un dispositivo por uno nuevo -- pensado para
 * cuando el original caducó o se perdió antes de que el instalador lo usara. SOLO
 * funciona sobre un dispositivo que todavía NO se ha emparejado (`paired_at is null`):
 * el `UPDATE` lleva esa guarda en el propio `WHERE`, así que un dispositivo ya emparejado
 * (o un `deviceId` que no existe / pertenece a otro tenant) actualiza cero filas.
 *
 * A propósito esto se trata como un fallo (lanza), no como un no-op silencioso: permitir
 * "regenerar" el código de un dispositivo activo reabriría la vía de emparejamiento en un
 * dispositivo que ya tiene su propia cuenta de servicio y sus propias sesiones -- qué
 * pasa con esas sesiones (¿se revocan? ¿conviven con las nuevas?) son preguntas de
 * revocación explícitamente diferidas a una fase posterior (ver el docstring de
 * `ensureDeviceAuthAccount` en `src/devices.ts`). Esta tarea prohíbe re-emparejar un
 * dispositivo activo hasta que esa fase resuelva la revocación; fallar alto y claro aquí
 * es preferible a dejar que alguien lo intente sin darse cuenta de que no ha pasado nada.
 */
export async function regeneratePairingCode(
  tenantId: string,
  deviceId: string,
  ttlMinutes?: number,
): Promise<RegeneratePairingCodeResult> {
  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + resolveTtlMinutes(ttlMinutes) * 60_000).toISOString();

  const { data, error } = await tenantScoped("devices", tenantId)
    .update({ pairing_code: pairingCode, pairing_expires_at: expiresAt })
    .eq("id", deviceId)
    .is("paired_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      "No se puede regenerar el código: el dispositivo ya está emparejado o no existe.",
    );
  }

  return { pairingCode, expiresAt };
}

type DeviceRowDb = {
  id: string;
  tenant_id: string;
  venue_id: string;
  name: string;
  roles: string[];
  pairing_code: string | null;
  pairing_expires_at: string | null;
  paired_at: string | null;
  last_seen_at: string | null;
};

/**
 * Lectura acotada al tenant para la pantalla de gestión de dispositivos (Task 5). NUNCA
 * selecciona `pairing_code` hacia el tipo público: se lee de la fila solo para derivar
 * `hasPendingPairingCode` (booleano) dentro de esta misma función, y el valor en claro se
 * descarta acto seguido -- no sobrevive más allá de este `map`. El único momento en que el
 * código en claro sale de este paquete es el valor de retorno de `createDevice`/
 * `regeneratePairingCode`, nunca desde aquí.
 */
export async function listDevices(tenantId: string): Promise<DeviceRow[]> {
  const { data, error } = await tenantScoped("devices", tenantId)
    .select(
      "id, tenant_id, venue_id, name, roles, pairing_code, pairing_expires_at, paired_at, last_seen_at",
    )
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data as DeviceRowDb[]).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    venueId: row.venue_id,
    name: row.name,
    roles: row.roles,
    hasPendingPairingCode: row.pairing_code !== null,
    pairingExpiresAt: row.pairing_expires_at,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
  }));
}

/** `printers.device_id` referencia `devices` con `on delete set null`
 * (`20260722000001_devices_printers.sql`): borrar un dispositivo desvincula sus
 * impresoras en vez de borrarlas también. */
export async function deleteDevice(tenantId: string, deviceId: string): Promise<void> {
  const { error } = await tenantScoped("devices", tenantId).delete().eq("id", deviceId);
  if (error) throw error;
}

/**
 * Resetea un dispositivo YA emparejado (robo, o cambio de PC). En un solo flujo:
 *   1. Si tiene cuenta de Auth, la BORRA (`deleteUser`) -- revoca sus refresh tokens y, en
 *      cascada, elimina su `memberships` (FK on delete cascade) y pone `auth_user_id` a null
 *      (FK on delete set null). LÍMITE HONESTO (JWT stateless): esto NO invalida un access
 *      token ya emitido antes de que caduque; lo que revoca de inmediato es la capacidad de
 *      RENOVAR y la membership. El PC robado pierde acceso como muy tarde al caducar su
 *      token en curso (TTL del proyecto). Mismo tipo de límite honesto que el ACK de
 *      impresión de C1.
 *   2. Desempareja (`paired_at = null`) y emite un código nuevo, para un PC de repuesto.
 * `deviceId` de otro tenant no casa el `tenantScoped` → no borra ni resetea nada ajeno.
 */
export async function resetDevice(
  tenantId: string,
  deviceId: string,
): Promise<{ pairingCode: string; expiresAt: string }> {
  const { data: device, error: readError } = await tenantScoped("devices", tenantId)
    .select("id, auth_user_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (readError) throw readError;
  if (!device) throw new Error("Dispositivo no encontrado en este tenant.");

  const authUserId = (device as { auth_user_id: string | null }).auth_user_id;
  if (authUserId) {
    const { error: deleteError } = await authAdminForDeviceReset().deleteUser(authUserId);
    if (deleteError) throw deleteError;
  }

  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + resolveTtlMinutes(undefined) * 60_000).toISOString();
  const { error: updateError } = await tenantScoped("devices", tenantId)
    .update({
      paired_at: null,
      auth_user_id: null,
      pairing_code: pairingCode,
      pairing_expires_at: expiresAt,
    })
    .eq("id", deviceId);
  if (updateError) throw updateError;

  return { pairingCode, expiresAt };
}
