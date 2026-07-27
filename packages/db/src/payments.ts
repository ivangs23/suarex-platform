import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantScoped } from "./client.js";

/**
 * Config de pago resuelta para un totem: la de la CUENTA del tenant más el terminal de ESTE
 * dispositivo.
 *
 * Deliberadamente sin vocabulario de ningún proveedor: qué claves llevan dentro `config` y
 * `secrets` lo decide quien las declaró (`@suarex/payments`), y este paquete no tiene por qué
 * saberlo. El `terminalId` viaja aparte porque no vive con la cuenta sino con el aparato, y es el
 * agente -- que sí conoce al proveedor -- quien lo coloca bajo el nombre de campo que toque.
 *
 * Los secretos SOLO llegan por aquí (RPC acotada al propio device), nunca por un SELECT.
 */
export type DevicePaymentConfig = {
  provider: string;
  config: Record<string, string>;
  secrets: Record<string, string>;
  mock: boolean;
  terminalId: string | null;
};

type PaymentConfigRow = {
  provider: string;
  config: Record<string, string> | null;
  secrets: Record<string, string> | null;
  mock: boolean;
  terminal_id: string | null;
};

/**
 * Config de pago del tenant del DEVICE que llama (más su propio terminal), vía la RPC
 * `get_payment_config_self_v2` (SECURITY DEFINER): el rol `device` no puede leer
 * `tenant_payment_config` directamente. `null` si el tenant no tiene config o quien llama no es
 * un device emparejado. Lo consume el agente en rol kiosko con el cliente del device.
 *
 * `_v2` y no la de siempre: la vieja sigue existiendo para los agentes ya desplegados, que
 * esperan las columnas de Paytef. Ver `20260726000001_payment_providers.sql`.
 */
export async function getPaymentConfigForDevice(
  client: SupabaseClient,
): Promise<DevicePaymentConfig | null> {
  const { data, error } = await client.rpc("get_payment_config_self_v2");
  if (error) throw error;
  const row = (data as PaymentConfigRow[] | null)?.[0];
  if (!row) return null;
  return {
    provider: row.provider,
    config: row.config ?? {},
    secrets: row.secrets ?? {},
    mock: row.mock,
    terminalId: row.terminal_id ?? null,
  };
}

/**
 * Config tal como la ve el PANEL (owner/admin): todo menos los secretos.
 *
 * De los secretos solo sale QUÉ está puesto, nunca el valor. `secretsSet` es una lista y no un
 * booleano porque un proveedor puede tener más de uno, y "hay algún secreto guardado" no permite
 * decirle al dueño cuál le falta.
 */
export type PaymentConfigForManager = {
  provider: string;
  config: Record<string, string>;
  /** Nombres de los campos secretos que ya tienen valor guardado. */
  secretsSet: string[];
  mock: boolean;
};

/**
 * Lee la config Paytef del tenant para el panel (owner/admin; la RLS `tenant_payment_config_manage`
 * se lo permite, al device no). NO devuelve `secret_key`: la clave secreta no baja al navegador --
 * solo se informa de si hay una guardada. `null` si el tenant aún no tiene config.
 */
export async function getPaymentConfigForManager(
  tenantId: string,
): Promise<PaymentConfigForManager | null> {
  const { data, error } = await tenantScoped("tenant_payment_config", tenantId)
    .select("provider, config, secrets, mock")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  /* `secrets` SÍ se lee aquí (con service role) y NO se devuelve: de él solo sale la lista de
     nombres con valor. Es la misma frontera que ya había con `secret_key` -- lo que no puede
     pasar es que el valor baje al navegador, no que este proceso lo tenga en memoria un instante
     para contar qué hay puesto. */
  const secrets = (data.secrets as Record<string, unknown> | null) ?? {};
  return {
    provider: (data.provider as string) ?? "",
    config: ((data.config as Record<string, string> | null) ?? {}) as Record<string, string>,
    secretsSet: Object.entries(secrets)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([name]) => name),
    mock: (data.mock as boolean) ?? true,
  };
}

/** Primer alta sin los secretos que el proveedor exige: no se puede crear una config a medias. */
export class MissingPaymentSecretError extends Error {
  /** Los nombres de campo que faltan, para que quien llama los traduzca a etiquetas. */
  readonly missing: string[];
  constructor(missing: string[] = []) {
    super(`Faltan secretos obligatorios: ${missing.join(", ")}`);
    this.name = "MissingPaymentSecretError";
    this.missing = missing;
  }
}

/**
 * Alta/edición de la config de pago del tenant (owner/admin; el rol se comprueba en la Server
 * Action). Nunca devuelve secretos.
 *
 * Los secretos que llegan se ESCRIBEN ENCIMA de los guardados, uno a uno, en vez de sustituir el
 * objeto entero. Es la generalización de la regla de siempre -- "en blanco = no cambiar" -- y
 * ahora importa más: con dos secretos, reemplazar el objeto borraría el que el dueño no ha
 * tocado, dejando la cuenta a medias sin que nadie lo note hasta el siguiente cobro. Quien llama
 * solo manda los que quiere cambiar (ver `splitByStorage` en `@suarex/payments`, que ya descarta
 * los vacíos).
 *
 * `requiredSecrets` son los nombres que el proveedor declara obligatorios. Solo se exigen en el
 * PRIMER alta: en una edición ya hay valor guardado y volver a pedirlo obligaría a teclear la
 * clave cada vez que se corrige una errata en otro campo.
 */
export async function setPaymentConfig(
  tenantId: string,
  input: {
    provider: string;
    config: Record<string, string>;
    /** Solo los secretos a CAMBIAR. Los ausentes conservan su valor guardado. */
    secrets?: Record<string, string>;
    mock?: boolean;
    requiredSecrets?: string[];
  },
): Promise<void> {
  const nuevos = input.secrets ?? {};
  const { data: existente, error: readError } = await tenantScoped(
    "tenant_payment_config",
    tenantId,
  )
    .select("secrets")
    .maybeSingle();
  if (readError) throw readError;

  const guardados = (existente?.secrets as Record<string, string> | null) ?? {};
  const secrets = { ...guardados, ...nuevos };

  const faltan = (input.requiredSecrets ?? []).filter((name) => !secrets[name]);
  if (faltan.length > 0) throw new MissingPaymentSecretError(faltan);

  const { error } = await tenantScoped("tenant_payment_config", tenantId).upsert(
    {
      provider: input.provider,
      config: input.config,
      secrets,
      mock: input.mock ?? true,
      updated_at: new Date().toISOString(),
    },
    "tenant_id",
  );
  if (error) throw error;
}

/** Pedido kiosko leído por el device para cobrarlo: importe en céntimos (del SERVIDOR, no del
 *  renderer) y estado (para no re-cobrar uno ya pagado). `null` si no existe o el device no lo ve. */
export type KioskoOrderForCharge = {
  amountCents: number;
  status: string;
  orderNumber: number;
};

/**
 * Lee un pedido kiosko con el JWT del device (RLS `orders_select` le permite ver los de su
 * tenant). El importe sale de aquí -- de la base -- nunca del renderer del totem, para que un
 * XSS en la carta no pueda cobrar un importe arbitrario. `null` si no existe o no es visible.
 */
export async function readKioskoOrderForCharge(
  client: SupabaseClient,
  orderId: string,
): Promise<KioskoOrderForCharge | null> {
  const { data, error } = await client
    .from("orders")
    .select("total, status, order_number, channel")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.channel !== "kiosko") return null;
  return {
    amountCents: Math.round(Number(data.total) * 100),
    status: data.status as string,
    orderNumber: data.order_number as number,
  };
}

/** Marca un pedido kiosko como pagado tras aprobar Paytef, vía la RPC acotada (el device no
 *  puede hacer UPDATE directo). Devuelve `true` si marcó una fila (pedido propio, kiosko, pending). */
export async function markKioskoOrderPaid(
  client: SupabaseClient,
  orderId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("mark_kiosko_order_paid", { p_order_id: orderId });
  if (error) throw error;
  return data === true;
}

/** Fija (o limpia) el pinpad de Paytef de un dispositivo (totem). Acotado al tenant. */
export async function setDevicePinpad(
  tenantId: string,
  deviceId: string,
  pinpadId: string | null,
): Promise<void> {
  const { error } = await tenantScoped("devices", tenantId)
    .update({ payment_terminal_id: pinpadId })
    .eq("id", deviceId);
  if (error) throw error;
}
