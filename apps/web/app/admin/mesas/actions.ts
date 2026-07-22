"use server";

import { createTable, deleteTable, updateTable } from "@suarex/db";
import { revalidatePath } from "next/cache";
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
 */

function requiredString(formData: FormData, field: string): string {
  const value = String(formData.get(field) ?? "").trim();
  if (!value) throw new Error(`Falta el campo obligatorio: ${field}`);
  return value;
}

function optionalString(formData: FormData, field: string): string | undefined {
  const raw = formData.get(field);
  if (raw === null) return undefined;
  const value = String(raw).trim();
  return value === "" ? undefined : value;
}

function parseOptionalInt(formData: FormData, field: string): number | undefined {
  const raw = optionalString(formData, field);
  return raw === undefined ? undefined : Number(raw);
}

function parseOptionalBoolean(formData: FormData, field: string): boolean | undefined {
  const raw = optionalString(formData, field);
  return raw === undefined ? undefined : raw === "true";
}

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
