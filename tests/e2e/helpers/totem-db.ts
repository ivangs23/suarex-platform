import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = process.env.SUPABASE_URL;
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!rawUrl || !rawServiceKey) {
  throw new Error(
    "Faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en .env.test. Corre `pnpm db:env`.",
  );
}

const admin: SupabaseClient = createClient(rawUrl, rawServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export type SeededTotem = { deviceId: string; token: string };

/**
 * Siembra un TOTEM: un `device` con rol `kiosko` en el venue por defecto del tenant, y devuelve
 * su `totem_token` (el que la ruta `/totem/<token>` resuelve). El seed compartido no trae
 * dispositivos, así que cada test del totem crea el suyo y lo borra en un `finally` -- dueño de
 * lo que crea, igual que los pedidos.
 */
export async function seedTotemDevice(tenantSlug: string): Promise<SeededTotem> {
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();
  if (tErr) throw tErr;

  const { data: venue, error: vErr } = await admin
    .from("venues")
    .select("id")
    .eq("tenant_id", tenant.id as string)
    .eq("is_default", true)
    .single();
  if (vErr) throw vErr;

  const { data, error } = await admin
    .from("devices")
    .insert({
      tenant_id: tenant.id as string,
      venue_id: venue.id as string,
      name: "Totem e2e",
      roles: ["kiosko"],
    })
    .select("id, totem_token")
    .single();
  if (error) throw error;
  return { deviceId: data.id as string, token: data.totem_token as string };
}

/** Borra el device sembrado. Se llama SIEMPRE desde un `finally`. */
export async function deleteDevice(deviceId: string): Promise<void> {
  const { error } = await admin.from("devices").delete().eq("id", deviceId);
  if (error) throw error;
}

/** Siembra un device NORMAL (rol agente, sin totem) para probar que el panel activa el kiosko. */
export async function seedPlainDevice(tenantSlug: string): Promise<{ deviceId: string }> {
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", tenantSlug).single();
  const { data: venue } = await admin
    .from("venues")
    .select("id")
    .eq("tenant_id", tenant?.id as string)
    .eq("is_default", true)
    .single();
  const { data, error } = await admin
    .from("devices")
    .insert({
      tenant_id: tenant?.id as string,
      venue_id: venue?.id as string,
      name: "Dispositivo e2e",
      roles: ["agente"],
    })
    .select("id")
    .single();
  if (error) throw error;
  return { deviceId: data.id as string };
}

/** Roles + pinpad de un device, para comprobar lo que el panel escribió. */
export async function deviceRolesAndPinpad(
  deviceId: string,
): Promise<{ roles: string[]; pinpadId: string | null }> {
  const { data, error } = await admin
    .from("devices")
    .select("roles, pinpad_id")
    .eq("id", deviceId)
    .single();
  if (error) throw error;
  return {
    roles: (data.roles as string[]) ?? [],
    pinpadId: (data.pinpad_id as string | null) ?? null,
  };
}

/** Borra la config Paytef de un tenant (limpieza tras el e2e del panel de pagos). */
export async function deletePaymentConfig(tenantSlug: string): Promise<void> {
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", tenantSlug).single();
  const { error } = await admin
    .from("tenant_payment_config")
    .delete()
    .eq("tenant_id", tenant?.id as string);
  if (error) throw error;
}

export type KioskoOrderInfo = {
  channel: string;
  tableLabel: string | null;
  status: string;
};

/** Canal, etiqueta de mesa y estado de un pedido, para comprobar que el totem creó el pedido
 *  `kiosko` correcto (con la mesa tecleada) antes de cobrar. */
export async function kioskoOrderInfo(orderId: string): Promise<KioskoOrderInfo> {
  const { data, error } = await admin
    .from("orders")
    .select("channel, table_label, status")
    .eq("id", orderId)
    .single();
  if (error) throw error;
  return {
    channel: data.channel as string,
    tableLabel: (data.table_label as string | null) ?? null,
    status: data.status as string,
  };
}
