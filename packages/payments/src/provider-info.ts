/**
 * LO QUE UN MÉTODO DE PAGO DECLARA DE SÍ MISMO, sin nada de cómo cobra.
 *
 * Vive en un paquete compartido y no en el agente porque hay DOS consumidores que no se conocen
 * entre sí: el agente, que cobra, y el panel web, que pinta el formulario de configuración. Si
 * esto viviera en el agente, el panel tendría que redeclarar los mismos campos a mano -- y el día
 * que un proveedor añadiera uno, habría que acordarse de tocarlo en los dos sitios. Que es
 * exactamente lo que esta abstracción existe para evitar.
 *
 * Aquí NO hay implementación: ni HTTP, ni datáfonos, ni secretos. Solo la descripción. Cobrar es
 * cosa del agente (`payment-provider.ts`), que es quien está en el local y tiene el aparato
 * delante.
 */

/**
 * Un dato que el proveedor necesita para funcionar.
 *
 * El `type` no es cosmético: decide DÓNDE se guarda y quién puede volver a verlo.
 *
 *   `text`     — se guarda en `config` y se puede releer y enseñar.
 *   `secret`   — se guarda en `secrets` y no vuelve NUNCA al navegador. Se informa de si está
 *                puesto, y para cambiarlo se teclea uno nuevo.
 *   `boolean`  — como `text`, con casilla en vez de campo.
 *   `terminal` — el identificador del aparato FÍSICO, y por eso no se guarda con la cuenta sino
 *                con el DISPOSITIVO: un comercio con dos totems tiene dos terminales y una sola
 *                cuenta. Va en la ficha del dispositivo, no en los ajustes de pago.
 */
export type ConfigField = {
  /** Clave con la que se guarda. Estable: cambiarla invalida lo ya configurado. */
  name: string;
  label: string;
  type: "text" | "secret" | "boolean" | "terminal";
  required: boolean;
  /** Una línea para el dueño del bar, no para un programador. */
  help?: string;
};

export type PaymentProviderInfo = {
  /** Identificador estable: es lo que se guarda en `tenant_payment_config.provider`. */
  id: string;
  /** Nombre para el desplegable del panel. */
  label: string;
  configFields: ConfigField[];
  /**
   * `true` si sabe contestar a "¿cómo acabó la operación X?" tras un reinicio.
   *
   * De esto depende que un cobro interrumpido por un corte de luz se resuelva SOLO o acabe en un
   * aviso al personal. Se declara para poder advertirlo al configurar, en vez de que se descubra
   * el día que se va la luz.
   */
  canPollSession: boolean;
};

/** Valores de configuración tal y como viajan: por nombre de campo. */
export type ConfigValues = Record<string, string | boolean | null | undefined>;

/** El campo del terminal, si el proveedor tiene uno. Se guarda aparte, en el dispositivo. */
export function terminalField(info: PaymentProviderInfo): ConfigField | null {
  return info.configFields.find((field) => field.type === "terminal") ?? null;
}

/** Los campos que van con la CUENTA (todo menos el terminal), que es lo que pinta el panel. */
export function accountFields(info: PaymentProviderInfo): ConfigField[] {
  return info.configFields.filter((field) => field.type !== "terminal");
}

/**
 * Qué falta por rellenar para poder cobrar de verdad, con las etiquetas que ve el dueño.
 *
 * En simulación no exige nada: el modo simulación sirve precisamente para probar el totem ANTES
 * de tener credenciales, y exigirlas ahí convertiría el modo seguro en un callejón sin salida.
 */
export function missingFields(
  info: PaymentProviderInfo,
  values: ConfigValues,
  mock: boolean,
): string[] {
  if (mock) return [];
  return info.configFields
    .filter((field) => field.required && !values[field.name])
    .map((field) => field.label);
}

/**
 * Reparte unos valores entre los tres sitios donde viven: la config visible, los secretos, y el
 * terminal del dispositivo.
 *
 * Lo hace a partir de la DECLARACIÓN del proveedor, no de una lista escrita a mano en el panel:
 * así, el día que un proveedor añada un secreto, va al sitio correcto sin que nadie se acuerde.
 *
 * Un secreto vacío NO se incluye: en una edición, vacío significa "no lo cambies" -- el valor
 * guardado no baja al navegador, así que no se puede reenviar, y tratarlo como un borrado dejaría
 * la cuenta sin clave cada vez que alguien corrigiera una errata en otro campo.
 */
export function splitByStorage(
  info: PaymentProviderInfo,
  values: ConfigValues,
): { config: Record<string, string>; secrets: Record<string, string>; terminal: string | null } {
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  let terminal: string | null = null;

  for (const field of info.configFields) {
    const raw = values[field.name];
    const texto = typeof raw === "boolean" ? String(raw) : (raw ?? "").toString().trim();

    if (field.type === "terminal") {
      terminal = texto === "" ? null : texto;
    } else if (field.type === "secret") {
      if (texto !== "") secrets[field.name] = texto;
    } else if (texto !== "") {
      config[field.name] = texto;
    }
  }

  return { config, secrets, terminal };
}
