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

/**
 * Un dato que el proveedor necesita para funcionar, DECLARADO por él mismo.
 *
 * Existe para que el panel pinte el formulario solo. Sin esto, cada proveedor nuevo obligaría a
 * escribir a mano su pantalla de ajustes -- y el trabajo de añadir un método de pago dejaría de
 * ser "implementar una interfaz" para pasar a ser "tocar cinco sitios", que es exactamente la
 * clase de acoplamiento que esta abstracción existe para evitar.
 */
export type ConfigField = {
  /** Clave con la que se guarda. Estable: cambiarla invalida lo ya configurado. */
  name: string;
  label: string;
  /**
   * `secret` no vuelve NUNCA al panel una vez guardado (se enseña "guardado", se puede sustituir,
   * no se puede leer). `terminal` es el identificador del aparato físico y vive en el DISPOSITIVO,
   * no en el tenant: un comercio con dos totems tiene dos terminales y una sola cuenta.
   */
  type: "text" | "secret" | "boolean" | "terminal";
  required: boolean;
  /** Una línea para el dueño del bar, no para un programador. */
  help?: string;
};

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

export type PaymentProvider = {
  /** Identificador estable: es lo que se guarda en `tenant_payment_config.provider`. */
  id: string;
  /** Nombre para el desplegable del panel. */
  label: string;
  /** Lo que este proveedor necesita que le configuren. */
  configFields: ConfigField[];
  /**
   * `true` si sabe contestar a "¿cómo acabó la operación X?" tras un reinicio.
   *
   * No es un detalle: de esto depende que un cobro interrumpido se resuelva SOLO o acabe en un
   * aviso al personal. Se declara para poder decírselo al dueño al configurar, en vez de que lo
   * descubra el día que se va la luz.
   */
  canPollSession: boolean;

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
 * Qué le falta a una configuración para poder cobrar de verdad.
 *
 * Devuelve las etiquetas de los campos obligatorios sin rellenar, para poder decirlo con palabras
 * en el panel. En modo simulación no exige nada: precisamente sirve para probar el totem ANTES de
 * tener credenciales, y exigirlas ahí convertiría el modo seguro en un callejón.
 */
export function missingFields(provider: PaymentProvider, config: ResolvedPaymentConfig): string[] {
  if (config.mock) return [];
  return provider.configFields
    .filter((field) => field.required && !config.values[field.name])
    .map((field) => field.label);
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
