import { randomUUID } from "node:crypto";
import { authAdminForDevicePairing, devicesTableForPairing, tenantScoped } from "./client.js";

export type PairDeviceResult = {
  deviceId: string;
  email: string;
  password: string;
  tenantId: string;
};

/** Códigos de error de `@supabase/auth-js` que significan "ya existe una cuenta con este email". */
const EMAIL_ALREADY_EXISTS_CODES = new Set(["email_exists", "user_already_exists"]);

function isEmailAlreadyExistsError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code && EMAIL_ALREADY_EXISTS_CODES.has(error.code)) return true;
  return (
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("already been registered")
  );
}

const LIST_USERS_PAGE_SIZE = 200;
/** Tope de páginas al buscar por email (ver `findAuthUserIdByEmail`): acota el escaneo,
 * no lo deja crecer sin límite ni siquiera en un entorno con muchísimos usuarios. */
const LIST_USERS_MAX_PAGES = 25;

/**
 * `@supabase/auth-js` 2.x no expone un filtro por email en `listUsers` (solo pagina por
 * `page`/`perPage`); no hay ningún "getUserByEmail" en la Admin API de este cliente. Como
 * el email del dispositivo es determinista (`device-{id}@devices.local`), y solo se
 * recurre a esto cuando `createUser` ya ha fallado con "already registered" -- es decir,
 * en el camino de recuperación de una cuenta huérfana (Bug 2), no en el camino feliz --
 * escanear páginas acotadas es aceptable: el volumen de `auth.users` de un tenant de
 * hostelería nunca se acerca a los 25 * 200 = 5000 usuarios que cubre este tope.
 */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const authAdmin = authAdminForDevicePairing();
  for (let page = 1; page <= LIST_USERS_MAX_PAGES; page += 1) {
    const { data, error } = await authAdmin.listUsers({ page, perPage: LIST_USERS_PAGE_SIZE });
    if (error) throw error;
    const match = data.users.find((user) => user.email === email);
    if (match) return match.id;
    if (data.users.length < LIST_USERS_PAGE_SIZE) return null; // última página, no hay más
  }
  return null;
}

/**
 * Da de alta (o recupera) la cuenta de Auth del dispositivo, de forma idempotente.
 *
 * Bug 2 (cuenta huérfana que bloquea el reintento): como el `pairing_code` ya se ha
 * borrado en el canje atómico ANTES de llegar aquí (ver `pairDevice`), un fallo en
 * cualquier paso posterior de un intento anterior (p. ej. el INSERT de `memberships`)
 * puede dejar esta cuenta de Auth ya creada pero sin enlazar. Un reintento (con un
 * código nuevo asignado a la misma fila de `devices`) volvería a llamar a `createUser`
 * con el mismo email determinista y recibiría "already registered" -- el dispositivo
 * quedaría imposible de emparejar para siempre si tratáramos eso como un fallo duro.
 *
 * En vez de eso: si `createUser` falla por email ya existente, se busca esa cuenta y se
 * le RESETEA la contraseña (nunca se guarda la contraseña en claro en ningún sitio, así
 * que no hay forma de recuperar la de un intento anterior; y si ese intento anterior
 * llegó a devolver credenciales a alguien, este re-emparejamiento las invalida a
 * propósito). El resultado es siempre exactamente una cuenta de Auth por dispositivo,
 * nunca dos, sin importar cuántas veces falle y se reintente el emparejamiento.
 */
async function ensureDeviceAuthAccount(
  email: string,
): Promise<{ authUserId: string; password: string }> {
  const authAdmin = authAdminForDevicePairing();
  const password = randomUUID();

  const { data: created, error: createError } = await authAdmin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!createError) {
    return { authUserId: created.user.id, password };
  }
  if (!isEmailAlreadyExistsError(createError)) throw createError;

  const existingAuthUserId = await findAuthUserIdByEmail(email);
  if (!existingAuthUserId) throw createError; // "already exists" pero no se encuentra: fallo real, no lo enmascaramos

  const { error: resetError } = await authAdmin.updateUserById(existingAuthUserId, { password });
  if (resetError) throw resetError;

  return { authUserId: existingAuthUserId, password };
}

/**
 * Canjea un código de emparejamiento por credenciales propias de un dispositivo. Este es
 * el único mecanismo por el que un instalador sin secretos (sin URL, sin anon key, sin
 * token) puede convertirse en una cuenta autenticada del tenant que lo dio de alta.
 *
 * Un código malformado y uno inexistente producen exactamente el mismo `null`: la
 * búsqueda de abajo es una simple comparación de texto (`pairing_code` no tiene ningún
 * formato exigido), así que no hay ninguna vía por la que un código "con forma rara"
 * dispare un error distinto de "no encontrado" -- ambos casos caen en la misma rama.
 * `apps/web/app/api/devices/pair/route.ts` refuerza esto mismo por su lado: cualquier
 * excepción que salga de aquí también se colapsa al mismo 404 que un `null`.
 *
 * Orden de las operaciones (deliberado, no intercambiable):
 *
 *   1. CANJE ATÓMICO: un único `UPDATE ... WHERE pairing_code = $1 AND
 *      pairing_expires_at > now() ... RETURNING`, sin SELECT previo. Bajo el nivel de
 *      aislamiento por defecto de Postgres (READ COMMITTED), si dos llamadas concurrentes
 *      compiten por el mismo código, Postgres serializa la actualización de esa fila: la
 *      segunda queda bloqueada por el lock de fila hasta que la primera confirma, y en
 *      cuanto confirma, la cláusula WHERE de la segunda se reevalúa contra la versión ya
 *      confirmada de la fila (con `pairing_code` ya a `null`) -- así que la segunda
 *      actualiza cero filas y `pairDevice` devuelve `null` para ella. No hay ninguna
 *      ventana entre "leer" y "escribir" porque no hay una lectura separada: la condición
 *      y la escritura son la MISMA sentencia. Esto es justo lo que arreglaba el bug
 *      original (SELECT, luego `createUser`, luego INSERT, luego el UPDATE que borraba el
 *      código -- dos llamadas concurrentes pasaban ambas el SELECT antes de que ninguna
 *      borrara nada).
 *   2. Crear (o recuperar, ver `ensureDeviceAuthAccount`) la cuenta de Auth de la sesión
 *      de servicio.
 *   3. Darle membership (`role = 'device'`) en el tenant del dispositivo -- con el
 *      service role, nunca por una vía que el propio dispositivo pudiera invocar (la
 *      fase B ya revocó la escritura de `memberships` a `authenticated`). Es un UPSERT
 *      sobre la clave primaria (`user_id, tenant_id`), no un INSERT liso: así un
 *      reintento tras un fallo parcial nunca puede producir una fila duplicada ni
 *      reventar contra la PK.
 *   4. Enlazar `auth_user_id` en `devices` (informativo para el futuro panel de
 *      administración; ya no forma parte de ninguna invariante de seguridad, esa vive
 *      enteramente en el paso 1 y en la idempotencia del paso 2-3).
 *   5. Devolver las credenciales. Nunca se vuelven a poder recuperar en texto claro: ni
 *      aquí ni en ningún otro sitio se persiste la contraseña tras este `return`.
 *
 * Nota sobre el orden código/cuenta: el código se borra en el paso 1, ANTES de que la
 * cuenta exista (necesario para que el canje sea de un solo uso y atómico). Eso significa
 * que un fallo en los pasos 2-4 deja el código ya consumido con la cuenta a medio
 * completar -- por diseño, `ensureDeviceAuthAccount` y el UPSERT del paso 3 hacen que
 * CUALQUIER reintento posterior (con un código nuevo apuntando a la misma fila de
 * `devices`) termine en el mismo estado final -- exactamente una cuenta de Auth,
 * exactamente una membership -- sin necesidad de que ese reintento reutilice el código
 * original.
 */
export async function pairDevice(pairingCode: string): Promise<PairDeviceResult | null> {
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await devicesTableForPairing()
    .update({ pairing_code: null, paired_at: claimedAt })
    .eq("pairing_code", pairingCode)
    .gt("pairing_expires_at", claimedAt)
    .select("id, tenant_id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return null;

  const deviceId = claimed.id as string;
  const tenantId = claimed.tenant_id as string;

  // `email` deriva del id del dispositivo (nunca de un dato introducido por el
  // instalador) para que dos dispositivos jamás puedan colisionar, y para que sea
  // estable entre reintentos del mismo dispositivo.
  const email = `device-${deviceId}@devices.local`;
  const { authUserId, password } = await ensureDeviceAuthAccount(email);

  const { error: membershipError } = await tenantScoped("memberships", tenantId).upsert(
    { user_id: authUserId, role: "device" },
    "user_id,tenant_id",
  );
  if (membershipError) throw membershipError;

  const { error: updateError } = await devicesTableForPairing()
    .update({ auth_user_id: authUserId })
    .eq("id", deviceId);
  if (updateError) throw updateError;

  return { deviceId, email, password, tenantId };
}
