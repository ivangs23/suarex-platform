import { PAYTEF_INFO } from "@suarex/payments";
import type {
  ChargeOpts,
  PaymentProvider,
  PaymentResult,
  PaymentSessionOutcome,
  ResolvedPaymentConfig,
} from "./payment-provider.js";
import { textValue } from "./payment-provider.js";
import { chargePaytef, type PaytefBridgeConfig, pollPaytefSession } from "./paytef.js";

/**
 * PAYTEF como proveedor de pago: el primero, y el que fija que el contrato sea suficiente.
 *
 * Todo lo que sabe de Paytef (la API cloud, el flujo auth -> start -> poll, el formato de las
 * respuestas) sigue viviendo en `paytef.ts`. Este fichero es solo la traducción entre el
 * vocabulario genérico -- "los valores que el dueño configuró" -- y el suyo. Es a propósito
 * aburrido: si adaptar un proveedor pidiera algo más que esto, el contrato estaría mal.
 */

/** Del vocabulario genérico al de Paytef. Un único sitio donde vive esa correspondencia. */
function aPaytef(config: ResolvedPaymentConfig): PaytefBridgeConfig {
  return {
    accessKey: textValue(config, "accessKey") ?? "",
    secretKey: textValue(config, "secretKey") ?? "",
    companyId: textValue(config, "companyId"),
    pinpad: textValue(config, "pinpad") ?? "",
    mock: config.mock,
  };
}

export const paytefProvider: PaymentProvider = {
  // La declaración (id, nombre, campos, si sabe reconsultar) viene entera del paquete compartido:
  // es la MISMA que lee el panel para pintar el formulario.
  ...PAYTEF_INFO,

  charge(
    config: ResolvedPaymentConfig,
    amountCents: number,
    reference: string,
    opts: ChargeOpts,
  ): Promise<PaymentResult> {
    return chargePaytef(aPaytef(config), amountCents, reference, opts);
  },

  async pollSession(
    config: ResolvedPaymentConfig,
    sessionId: string,
  ): Promise<PaymentSessionOutcome> {
    const interp = await pollPaytefSession(aPaytef(config), sessionId);
    if (interp.kind !== "final") return { kind: "unknown" };
    return interp.approved
      ? { kind: "approved", authCode: interp.authCode }
      : { kind: "declined", reason: interp.reason };
  },
};
