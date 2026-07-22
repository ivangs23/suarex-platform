"use server";

import { createStaff } from "@suarex/db";
import { revalidatePath } from "next/cache";
import { requiredString } from "@/lib/form-parse";
import { managerAction } from "@/lib/require-manager";
import { parseStaffPassword } from "@/lib/staff-action-input";

/**
 * SECURITY: `managerAction` comprueba owner/admin ANTES del cuerpo (ver `catalogo/actions.ts`).
 * El alta usa service role dentro de `createStaff`, que SALTA RLS -- así que esta
 * comprobación de rol es el ÚNICO control estructural de este camino, obligatoria y probada
 * (el e2e `admin-d3.spec.ts` verifica que un staff no puede llegar aquí). El `tenantId` es
 * siempre `session.tenantId`, nunca del formulario.
 */
export const createStaffAction = managerAction(async (session, formData: FormData) => {
  const email = requiredString(formData, "email");
  const password = parseStaffPassword(formData);

  await createStaff(session.tenantId, { email, password });
  revalidatePath("/admin/personal");
});
