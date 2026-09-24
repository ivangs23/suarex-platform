"use server";

import { createPrinter, deletePrinter, updatePrinter } from "@suarex/db";
import { revalidatePath } from "next/cache";
import {
  optionalString,
  parseOptionalBoolean,
  parseOptionalInt,
  requiredString,
} from "@/lib/form-parse";
import { managerAction } from "@/lib/require-manager";

/**
 * SECURITY: mismo patrón obligatorio que `apps/web/app/admin/mesas/actions.ts` y
 * `apps/web/app/admin/dispositivos/actions.ts` (ver el docstring de
 * `apps/web/app/admin/catalogo/actions.ts` para el razonamiento completo):
 *
 *   1. Cada action de este fichero se define como
 *      `managerAction(async (session, formData) => { ... })` -- el wrapper ejecuta la
 *      comprobación de rol ANTES de invocar el cuerpo, así que no hay ningún camino de
 *      ejecución que la sortee.
 *   2. El `tenantId` que llega a cada repositorio de `@suarex/db` es SIEMPRE
 *      `session.tenantId` (derivado del claim `tenant_id` verificado del JWT), NUNCA un
 *      campo del `formData` que el navegador controla. Ninguna función de este fichero
 *      acepta ni lee un `tenant_id`/`tenantId` del formulario.
 *
 * `requiredString`/`optionalString`/`parseOptionalInt`/`parseOptionalBoolean` se importan
 * de `apps/web/lib/form-parse.ts` (consolidadas ahí, ver su docstring) -- no se redeclaran
 * aquí.
 *
 * El `port` en `createPrinterAction` se convierte con `Number(requiredString(...))`, igual
 * que `parseEuroPrice` en `catalogo/actions.ts`: un valor no numérico produce `NaN`, que
 * NO se rechaza en esta capa -- lo rechaza `createPrinter`/`updatePrinter` (repositorio),
 * que es donde vive la única validación de host/port (ver el docstring de
 * `buildNetworkConnection` en `packages/db/src/admin-printers.ts`), para que cualquier
 * otro caller futuro quede protegido igual sin arriesgarse a que dos copias de la misma
 * regla diverjan. En la actualización, `port` es opcional y usa `parseOptionalInt`
 * (ya rechaza un valor no finito) por el mismo motivo que `sortOrder` en
 * `mesas/actions.ts`.
 */

/**
 * Igual de permisivo que `parseDestination` en `catalogo/actions.ts` (dos valores allí,
 * tres aquí): un `destination` ausente devuelve `undefined` (no toca el campo en un
 * update); cualquier valor presente que no sea exactamente "barra" o "all" -- incluido el
 * propio "cocina", un typo, o una cadena vacía -- se trata como "cocina". A diferencia del
 * filtro anterior (que solo dejaba pasar "barra"/"all" y convertía silenciosamente
 * "cocina" en `undefined`, perdiendo la intención de volver a poner una impresora en
 * "cocina" tras haberla cambiado a otra cosa), aquí un `destination` presente SIEMPRE
 * produce un valor de los tres, nunca `undefined`.
 */
function parseDestination(formData: FormData): "cocina" | "barra" | "all" | "recibo" | undefined {
  const raw = formData.get("destination");
  if (raw === null) return undefined;
  if (raw === "barra") return "barra";
  if (raw === "all") return "all";
  if (raw === "recibo") return "recibo";
  return "cocina";
}

export const createPrinterAction = managerAction(async (session, formData: FormData) => {
  const venueId = requiredString(formData, "venue_id");
  const name = requiredString(formData, "name");

  const connectionType = optionalString(formData, "connection_type") ?? "network";
  const connection =
    connectionType === "usb"
      ? { type: "usb" as const, printerName: requiredString(formData, "printer_name") }
      : {
          type: "network" as const,
          host: requiredString(formData, "host"),
          port: Number(requiredString(formData, "port")),
        };

  await createPrinter(session.tenantId, {
    venueId,
    name,
    connection,
    destination: parseDestination(formData),
    deviceId: optionalString(formData, "device_id"),
    isDefault: parseOptionalBoolean(formData, "is_default"),
    enabled: parseOptionalBoolean(formData, "enabled"),
  });
  revalidatePath("/admin/impresoras");
});

export const updatePrinterAction = managerAction(async (session, formData: FormData) => {
  const printerId = requiredString(formData, "printer_id");
  const host = optionalString(formData, "host");
  const port = parseOptionalInt(formData, "port");

  await updatePrinter(session.tenantId, printerId, {
    venueId: optionalString(formData, "venue_id"),
    name: optionalString(formData, "name"),
    connection:
      host !== undefined && port !== undefined ? { type: "network", host, port } : undefined,
    destination: parseDestination(formData),
    // `optionalString` nunca devuelve "" (ver su docstring): un `device_id` ausente o en
    // blanco produce `undefined` -- "no tocar este campo" para `updatePrinter`, no "poner
    // a null". Desvincular una impresora de su dispositivo (device_id -> null) queda para
    // cuando la pantalla de gestión (Task 5) lo necesite explícitamente; hasta entonces no
    // hay ningún camino por el que este formulario pueda producir ese valor.
    deviceId: optionalString(formData, "device_id"),
    isDefault: parseOptionalBoolean(formData, "is_default"),
    enabled: parseOptionalBoolean(formData, "enabled"),
  });
  revalidatePath("/admin/impresoras");
});

export const deletePrinterAction = managerAction(async (session, formData: FormData) => {
  const printerId = requiredString(formData, "printer_id");

  await deletePrinter(session.tenantId, printerId);
  revalidatePath("/admin/impresoras");
});
