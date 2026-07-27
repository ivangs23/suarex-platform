/**
 * EL CONTRATO DE UN MÉTODO DE PAGO.
 *
 * El totem no sabe cobrar: sabe pedir que se cobre. Manda un importe y una referencia, espera un
 * veredicto, y con ese veredicto imprime o no imprime. Todo lo que hay entre esas dos cosas --
 * hablar con un datáfono por la nube, por un puerto serie o por lo que sea -- es asunto del
 * PROVEEDOR, y por eso vive detrás de esta interfaz.
 *
 * Hoy el único proveedor es Paytef. Mañana un cliente puede querer otro, y lo que tiene que costar
 * eso es escribir un fichero que implemente esto -- no tocar la carta, ni el diario de cobros, ni
 * el panel, ni la ventana del totem.
 *
 * Alcance HONESTO de esta interfaz: cobrar en un TERMINAL DESATENDIDO presente en el local. NO
 * cubre pasarelas de redirección (el cliente se va a una web del banco a pagar), que son otra
 * forma de cobrar y otro flujo: en un totem no hay navegador al que mandar a nadie. Si algún día
 * hace falta eso, será otra abstracción, no un proveedor más metido a la fuerza aquí.
 */

import type { PaymentProviderInfo } from "@suarex/payments";

/** Estados que el proveedor va contando para que la pantalla acompañe al cliente. */
export type PaymentStatus = "initializing" | "waiting_card" | "processing" | "success" | "error";

export type PaymentResult =
  | { approved: true; authCode: string }
  | { approved: false; reason: string };

/** Cómo acabó una operación por la que se vuelve a preguntar (recuperación tras una caída). */
export type PaymentSessionOutcome =
  | { kind: "approved"; authCode: string }
  | { kind: "declined"; reason: string }
  /** No se puede saber: sesión caducada, sin red, o un proveedor que no sabe contestar a esto. */
  | { kind: "unknown" };

/** La config ya resuelta de un proveedor: lo del tenant y lo de ESTE dispositivo, junto. */
export type ResolvedPaymentConfig = {
  provider: string;
  /** Valores de los campos declarados, ya mezclados (config del tenant + terminal del device). */
  values: Record<string, string | boolean | null>;
  /** Modo simulación: aprueba sin cobrar. Común a todos los proveedores, no lo declara ninguno. */
  mock: boolean;
};

export type ChargeOpts = {
  onStatus?: (status: PaymentStatus, message: string) => void;
  isCancelled?: () => boolean;
  /**
   * Se llama -- y se ESPERA -- en cuanto la operación tiene un identificador con el que se pueda
   * volver a preguntar por ella. El diario lo apunta ahí: es lo único que permite recuperar un
   * cobro si el totem muere a mitad. Un proveedor que no tenga ese concepto no lo llama, y
   * entonces esa recuperación cae en manos de una persona (ver `canPollSession`).
   */
  onSession?: (sessionId: string) => void | Promise<void>;
};

/**
 * Un proveedor EJECUTABLE: lo que declara (compartido con el panel, `@suarex/payments`) más lo
 * único que el panel no necesita y el agente sí -- cobrar de verdad.
 *
 * La declaración no se repite aquí a propósito. Si el agente tuviera su propia copia de los
 * campos, el día que un proveedor añadiera uno habría que acordarse de tocarlo en dos sitios, y
 * la pantalla de ajustes y el cobro empezarían a discrepar en silencio.
 */
export type PaymentProvider = PaymentProviderInfo & {
  charge(
    config: ResolvedPaymentConfig,
    amountCents: number,
    reference: string,
    opts: ChargeOpts,
  ): Promise<PaymentResult>;

  /** Solo si `canPollSession`. Un intento, sin bucle: corre al arrancar, no con gente delante. */
  pollSession?(config: ResolvedPaymentConfig, sessionId: string): Promise<PaymentSessionOutcome>;
};

/** Lee un campo declarado como texto, con el vacío normalizado a `null`. */
export function textValue(config: ResolvedPaymentConfig, name: string): string | null {
  const value = config.values[name];
  if (typeof value !== "string") return null;
  const texto = value.trim();
  return texto === "" ? null : texto;
}

/**
 * El registro de proveedores disponibles.
 *
 * Un mapa y no un `switch` repartido por el código: añadir un proveedor es añadir una entrada, y
 * quien pregunte "¿cuáles hay?" -- el panel, para su desplegable -- tiene un único sitio al que
 * mirar. Un `provider` desconocido devuelve `null` en vez de reventar: una fila de la base con un
 * proveedor de una versión más nueva no puede tumbar el totem.
 */
export function createProviderRegistry(providers: PaymentProvider[]) {
  const porId = new Map(providers.map((provider) => [provider.id, provider]));
  return {
    get: (id: string): PaymentProvider | null => porId.get(id) ?? null,
    list: (): PaymentProvider[] => [...porId.values()],
  };
}
