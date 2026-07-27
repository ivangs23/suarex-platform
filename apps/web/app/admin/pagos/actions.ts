"use server";

import { MissingPaymentSecretError, setPaymentConfig } from "@suarex/db";
import { type ConfigValues, findProvider, missingFields, splitByStorage } from "@suarex/payments";
import { revalidatePath } from "next/cache";
import { parseOptionalBoolean, requiredString } from "@/lib/form-parse";
import { managerAction } from "@/lib/require-manager";

/**
 * Config del método de pago del tenant. Mismo patrón obligatorio que el resto del panel
 * (`managerAction`, ver `dispositivos/actions.ts`): el rol se comprueba ANTES del cuerpo y el
 * `tenantId` sale SIEMPRE de la sesión verificada, nunca del formulario.
 *
 * Los campos NO están escritos aquí: se leen del formulario a partir de lo que declara el
 * proveedor elegido (`configFields`). Eso es lo que hace que añadir un método de pago mañana no
 * obligue a tocar esta acción -- y también lo que impide que un campo colado en el formulario, de
 * otro proveedor o inventado, acabe guardado (`splitByStorage` solo mira lo declarado).
 *
 * La regla del secreto se conserva y se generaliza: un secreto en blanco significa "no lo
 * cambies". El valor guardado no baja al navegador, así que no se puede reenviar; tratar el
 * blanco como un borrado dejaría la cuenta sin clave cada vez que alguien tocara el modo pruebas.
 */
export type PaymentConfigState = { ok?: boolean; error?: string };

export const setPaymentConfigAction = managerAction(
  async (session, _prev: PaymentConfigState, formData: FormData): Promise<PaymentConfigState> => {
    const providerId = requiredString(formData, "provider");
    const provider = findProvider(providerId);
    if (!provider) return { error: "Ese método de pago no existe." };

    const mock = parseOptionalBoolean(formData, "mock") ?? false;

    // Lo que el proveedor declaró, y solo eso.
    const values: ConfigValues = {};
    for (const field of provider.configFields) {
      const raw = formData.get(field.name);
      if (raw !== null) values[field.name] = String(raw);
    }

    /* El terminal no se pide aquí: vive en la ficha del dispositivo, porque un comercio con dos
       totems tiene dos aparatos y una sola cuenta. Así que no puede contar como "falta" en esta
       pantalla -- sería pedirle al dueño algo que no está en ella. */
    const sinTerminal = provider.configFields
      .filter((field) => field.type === "terminal")
      .map((field) => field.name);
    const faltan = missingFields(provider, values, mock).filter(
      (label) =>
        !sinTerminal.some(
          (name) => provider.configFields.find((f) => f.name === name)?.label === label,
        ),
    );
    if (faltan.length > 0) {
      return { error: `Faltan datos obligatorios: ${faltan.join(", ")}.` };
    }

    const { config, secrets } = splitByStorage(provider, values);

    try {
      await setPaymentConfig(session.tenantId, {
        provider: providerId,
        config,
        secrets,
        mock,
        requiredSecrets: provider.configFields
          .filter((field) => field.type === "secret" && field.required && !mock)
          .map((field) => field.name),
      });
    } catch (error) {
      if (error instanceof MissingPaymentSecretError) {
        const etiquetas = error.missing.map(
          (name) => provider.configFields.find((f) => f.name === name)?.label ?? name,
        );
        return { error: `Introduce ${etiquetas.join(" y ")} para guardar la configuración.` };
      }
      throw error;
    }
    revalidatePath("/admin/pagos");
    return { ok: true };
  },
);
