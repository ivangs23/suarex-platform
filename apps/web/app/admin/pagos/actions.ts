"use server";

import { MissingPaymentSecretError, setPaymentConfig } from "@suarex/db";
import { revalidatePath } from "next/cache";
import { optionalString, parseOptionalBoolean, requiredString } from "@/lib/form-parse";
import { managerAction } from "@/lib/require-manager";

/**
 * Config de pago (Paytef) del tenant. Mismo patrón obligatorio que el resto del panel
 * (`managerAction`, ver `dispositivos/actions.ts`): el rol se comprueba ANTES del cuerpo y el
 * `tenantId` sale SIEMPRE de la sesión verificada, nunca del formulario.
 *
 * La clave secreta se trata aparte: si el campo llega en blanco y ya hay config, se CONSERVA la
 * guardada (`setPaymentConfig` no la pisa) -- así tocar el modo test no obliga a re-teclear el
 * secreto. En el primer alta sí es obligatoria: `MissingPaymentSecretError` se traduce a un
 * mensaje para el formulario, sin reventar la acción.
 */
export type PaymentConfigState = { ok?: boolean; error?: string };

export const setPaymentConfigAction = managerAction(
  async (session, _prev: PaymentConfigState, formData: FormData): Promise<PaymentConfigState> => {
    const accessKey = requiredString(formData, "access_key");
    // `optionalString` nunca devuelve "": un secreto en blanco llega como `undefined` = conservar.
    const secretKey = optionalString(formData, "secret_key");
    const companyId = optionalString(formData, "company_id") ?? null;
    const mock = parseOptionalBoolean(formData, "mock") ?? false;

    try {
      await setPaymentConfig(session.tenantId, { accessKey, secretKey, companyId, mock });
    } catch (error) {
      if (error instanceof MissingPaymentSecretError) {
        return { error: "Introduce la clave secreta de Paytef para guardar la configuración." };
      }
      throw error;
    }
    revalidatePath("/admin/pagos");
    return { ok: true };
  },
);
