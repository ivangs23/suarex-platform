import type {
  ChargeOpts,
  ConfigField,
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

const CAMPOS: ConfigField[] = [
  {
    name: "accessKey",
    label: "Clave de acceso",
    type: "text",
    required: true,
    help: "Te la da Paytef al dar de alta la cuenta.",
  },
  {
    name: "secretKey",
    label: "Clave secreta",
    type: "secret",
    required: true,
    help: "Se guarda cifrada y no vuelve a mostrarse. Para cambiarla, escribe una nueva.",
  },
  {
    name: "companyId",
    label: "Identificador de comercio",
    type: "text",
    required: false,
  },
  {
    name: "pinpad",
    label: "Datáfono de este totem",
    type: "terminal",
    required: true,
    help: "El número del aparato físico. Si tienes varios totems, cada uno lleva el suyo.",
  },
];

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
  id: "paytef",
  label: "Paytef (datáfono por la nube)",
  configFields: CAMPOS,
  // Paytef devuelve una sesión al iniciar la operación y deja volver a preguntar por ella. Eso es
  // lo que permite que un cobro interrumpido por un corte de luz se resuelva solo al arrancar.
  canPollSession: true,

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
