"use server";

import {
  createDevice,
  deleteDevice,
  type RegeneratePairingCodeResult,
  regeneratePairingCode,
} from "@suarex/db";
import { revalidatePath } from "next/cache";
import { parsePairingTtlMinutes } from "@/lib/device-action-input";
import { requiredString } from "@/lib/form-parse";
import { managerAction } from "@/lib/require-manager";

/**
 * SECURITY: mismo patrón obligatorio que `apps/web/app/admin/catalogo/actions.ts` y
 * `apps/web/app/admin/mesas/actions.ts` (ver el docstring de ese primero para el
 * razonamiento completo):
 *
 *   1. Cada action de este fichero se define como
 *      `managerAction(async (session, formData) => { ... })` en vez de empezar a mano por
 *      `const session = await requireManager();` -- el wrapper ejecuta la comprobación de
 *      rol ANTES de invocar el cuerpo, así que no hay ningún camino de ejecución que la
 *      sortee.
 *   2. El `tenantId` que llega a cada repositorio de `@suarex/db` es SIEMPRE
 *      `session.tenantId` (derivado del claim `tenant_id` verificado del JWT), NUNCA un
 *      campo del `formData` que el navegador controla. Ninguna función de este fichero
 *      acepta ni lee un `tenant_id`/`tenantId` del formulario.
 *
 * `createDeviceAction`/`regeneratePairingCodeAction` son las ÚNICAS dos actions de todo
 * el panel que devuelven algo (`managerAction` es genérico en `R` desde este mismo
 * cambio, ver `apps/web/lib/require-manager.ts`): el código de emparejamiento en claro
 * SOLO viaja en el valor de retorno de esta invocación -- nunca se registra en logs
 * (ni aquí ni en `packages/db/src/admin-devices.ts`, que tampoco lo hace), y nunca vuelve
 * a leerse de la base una vez creado (`listDevices` no lo expone, ver su docstring). Es
 * responsabilidad exclusiva de quien invoque esta action mostrarlo una única vez a la
 * persona que está instalando el dispositivo.
 *
 * Fix round 2 (Finding 1, seguridad): `ttl_minutes` ya no llega a `createDevice`/
 * `regeneratePairingCode` como un `Number(raw)` sin cota -- `parsePairingTtlMinutes`
 * (`apps/web/lib/device-action-input.ts`) lo valida aquí, en el borde de la Server Action,
 * como entero positivo acotado a 24 horas, ANTES de que el repositorio lo vea. Ver el
 * docstring de ese módulo para el porqué completo; el repositorio aplica el mismo tope
 * como defensa en profundidad para cualquier otro caller futuro que no pase por esta action.
 *
 * Fix round 2 (Finding 3): `requiredString` ya no se redeclara aquí -- se importa de
 * `apps/web/lib/form-parse.ts`, compartido con `catalogo/actions.ts` y `mesas/actions.ts`.
 */

export const createDeviceAction = managerAction(
  async (session, formData: FormData): Promise<{ pairingCode: string; expiresAt: string }> => {
    const venueId = requiredString(formData, "venue_id");
    const name = requiredString(formData, "name");
    const ttlMinutes = parsePairingTtlMinutes(formData);

    const { pairingCode, expiresAt } = await createDevice(session.tenantId, {
      venueId,
      name,
      ttlMinutes,
    });
    revalidatePath("/admin/dispositivos");
    return { pairingCode, expiresAt };
  },
);

export const regeneratePairingCodeAction = managerAction(
  async (session, formData: FormData): Promise<RegeneratePairingCodeResult> => {
    const deviceId = requiredString(formData, "device_id");
    const ttlMinutes = parsePairingTtlMinutes(formData);

    const result = await regeneratePairingCode(session.tenantId, deviceId, ttlMinutes);
    revalidatePath("/admin/dispositivos");
    return result;
  },
);

export const deleteDeviceAction = managerAction(async (session, formData: FormData) => {
  const deviceId = requiredString(formData, "device_id");

  await deleteDevice(session.tenantId, deviceId);
  revalidatePath("/admin/dispositivos");
});
