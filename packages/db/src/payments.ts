import type { SupabaseClient } from "@supabase/supabase-js";
import { tenantScoped } from "./client.js";

/** Config de pago (Paytef) resuelta para un totem: credenciales de cuenta del tenant + el pinpad
 *  de ESTE dispositivo. `secretKey` es sensible; solo llega por la RPC acotada, nunca por SELECT. */
export type PaytefConfig = {
  provider: string;
  accessKey: string;
  secretKey: string;
  companyId: string | null;
  mock: boolean;
  pinpadId: string | null;
};

type PaymentConfigRow = {
  provider: string;
  access_key: string;
  secret_key: string;
  company_id: string | null;
  mock: boolean;
  pinpad_id: string | null;
};

/**
 * Config de pago del tenant del DEVICE que llama (más su propio pinpad), vía la RPC
 * `get_payment_config_self` (SECURITY DEFINER): el rol `device` no puede leer
 * `tenant_payment_config` directamente. `null` si el tenant no tiene config o quien llama no es
 * un device emparejado. Lo consume el agente en rol kiosko con el cliente del device.
 */
export async function getPaymentConfigForDevice(
  client: SupabaseClient,
): Promise<PaytefConfig | null> {
  const { data, error } = await client.rpc("get_payment_config_self");
  if (error) throw error;
  const row = (data as PaymentConfigRow[] | null)?.[0];
  if (!row) return null;
  return {
    provider: row.provider,
    accessKey: row.access_key,
    secretKey: row.secret_key,
    companyId: row.company_id ?? null,
    mock: row.mock,
    pinpadId: row.pinpad_id ?? null,
  };
}

/**
 * Alta/edición de la config Paytef del tenant (la gestiona owner/admin desde el panel; el rol se
 * verifica en la Server Action). Upsert por `tenant_id`. No devuelve el secreto.
 */
export async function setPaymentConfig(
  tenantId: string,
  input: { accessKey: string; secretKey: string; companyId?: string | null; mock?: boolean },
): Promise<void> {
  const { error } = await tenantScoped("tenant_payment_config", tenantId).upsert(
    {
      provider: "paytef",
      access_key: input.accessKey,
      secret_key: input.secretKey,
      company_id: input.companyId ?? null,
      mock: input.mock ?? true,
      updated_at: new Date().toISOString(),
    },
    "tenant_id",
  );
  if (error) throw error;
}

/** Fija (o limpia) el pinpad de Paytef de un dispositivo (totem). Acotado al tenant. */
export async function setDevicePinpad(
  tenantId: string,
  deviceId: string,
  pinpadId: string | null,
): Promise<void> {
  const { error } = await tenantScoped("devices", tenantId)
    .update({ pinpad_id: pinpadId })
    .eq("id", deviceId);
  if (error) throw error;
}
