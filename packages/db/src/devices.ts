import { randomUUID } from "node:crypto";
import { authAdminForDevicePairing, devicesTableForPairing, tenantScoped } from "./client.js";

export type PairDeviceResult = {
  deviceId: string;
  email: string;
  password: string;
  tenantId: string;
};

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
 *   1. Buscar el dispositivo por `pairing_code`, exigiendo que no haya caducado.
 *   2. Crear la cuenta de Supabase Auth de la sesión de servicio.
 *   3. Darle membership (`role = 'device'`) en el tenant del dispositivo -- con el
 *      service role, nunca por una vía que el propio dispositivo pudiera invocar (la
 *      fase B ya revocó la escritura de `memberships` a `authenticated`).
 *   4-5. Enlazar `auth_user_id`/`paired_at` en `devices` y, en la MISMA actualización,
 *      borrar `pairing_code` -- así el código deja de ser un valor de búsqueda válido
 *      en cuanto el emparejamiento se completa, de un solo uso.
 *   6. Devolver las credenciales. Nunca se vuelven a poder recuperar: ni aquí ni en
 *      ningún otro sitio se persiste la contraseña en claro tras este `return`.
 */
export async function pairDevice(pairingCode: string): Promise<PairDeviceResult | null> {
  const { data: device, error: findError } = await devicesTableForPairing()
    .select("id, tenant_id")
    .eq("pairing_code", pairingCode)
    .gt("pairing_expires_at", new Date().toISOString())
    .maybeSingle();
  if (findError) throw findError;
  if (!device) return null;

  const deviceId = device.id as string;
  const tenantId = device.tenant_id as string;

  // Ni la URL ni la anon key viajan en el instalador: el dispositivo solo necesita
  // llegar a existir como cuenta de Auth con estas credenciales, generadas aquí y no
  // recuperables después. `email` deriva del id del dispositivo (nunca de un dato
  // introducido por el instalador) para que dos dispositivos jamás puedan colisionar.
  const email = `device-${deviceId}@devices.local`;
  const password = randomUUID();

  const { data: authUser, error: authError } = await authAdminForDevicePairing().createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) throw authError;

  // El service role crea la membership directamente: el dispositivo nunca podría
  // hacerlo por sí mismo (memberships_lockdown revocó ese INSERT a `authenticated`), y
  // esta es precisamente la vía decidida para que reciba su `tenant_id` en el JWT por
  // el mismo `custom_access_token_hook` que el personal, sin tocar el hook.
  const { error: membershipError } = await tenantScoped("memberships", tenantId).insert({
    user_id: authUser.user.id,
    role: "device",
  });
  if (membershipError) throw membershipError;

  const { error: updateError } = await devicesTableForPairing()
    .update({
      auth_user_id: authUser.user.id,
      paired_at: new Date().toISOString(),
      pairing_code: null,
    })
    .eq("id", deviceId);
  if (updateError) throw updateError;

  return { deviceId, email, password, tenantId };
}
