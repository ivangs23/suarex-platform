"use server";

import { createTable, deleteTable, updateTable } from "@suarex/db";
import { revalidatePath } from "next/cache";
import {
  optionalString,
  parseOptionalBoolean,
  parseOptionalInt,
  requiredString,
} from "@/lib/form-parse";
import { managerAction } from "@/lib/require-manager";

/**
 * SECURITY: mismo patrón obligatorio que `apps/web/app/admin/catalogo/actions.ts` (ver el
 * docstring de ese fichero para el razonamiento completo):
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
 * La composición de la URL del QR (Host de la petición + token de la mesa) no vive aquí:
 * estas tres actions solo mutan filas de `tables`; la lectura que compone esa URL y llama
 * a `tableQrSvg` (`apps/web/lib/qr.ts`) es responsabilidad de la pantalla de gestión de
 * mesas (Task 5), que lee el Host con `headers()` de Next -- nunca de un campo de
 * `formData` -- exactamente igual que `requireTenant`/`resolveStaffSession` ya hacen para
 * resolver el tenant de la petición (ver `apps/web/lib/tenant-context.ts`).
 *
 * Fix round 2 (Finding 3): `requiredString`/`optionalString`/`parseOptionalInt`/
 * `parseOptionalBoolean` ya no se redeclaran aquí -- se importan de
 * `apps/web/lib/form-parse.ts`, compartido con `catalogo/actions.ts` y
 * `dispositivos/actions.ts`. `parseOptionalInt` ahora rechaza un `sort_order` no numérico
 * (antes producía `NaN` en silencio, ver el docstring de ese módulo) en vez de dejarlo
 * llegar a la columna `integer` del repositorio.
 */

export const createTableAction = managerAction(async (session, formData: FormData) => {
  const venueId = requiredString(formData, "venue_id");
  const label = requiredString(formData, "label");
  const sortOrder = parseOptionalInt(formData, "sort_order");

  await createTable(session.tenantId, { venueId, label, sortOrder });
  revalidatePath("/admin/mesas");
});

export const updateTableAction = managerAction(async (session, formData: FormData) => {
  const tableId = requiredString(formData, "table_id");

  await updateTable(session.tenantId, tableId, {
    venueId: optionalString(formData, "venue_id"),
    label: optionalString(formData, "label"),
    sortOrder: parseOptionalInt(formData, "sort_order"),
    isActive: parseOptionalBoolean(formData, "is_active"),
  });
  revalidatePath("/admin/mesas");
});

export const deleteTableAction = managerAction(async (session, formData: FormData) => {
  const tableId = requiredString(formData, "table_id");

  await deleteTable(session.tenantId, tableId);
  revalidatePath("/admin/mesas");
});
