import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AgentCredentials = {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
  /** Tenant del dispositivo. Solo lo usa `runAgent` para nombrar el canal de Realtime; el
   *  aislamiento real lo da RLS, no el nombre. Opcional: los tests que crean el cliente para
   *  llamar a `runAgentTick` directamente no lo necesitan. */
  tenantId?: string;
};

/**
 * Cliente Supabase del DISPOSITIVO: anon key + credenciales propias (las que devolvió el
 * emparejamiento). NUNCA la service key -- el PC del cliente jamás debe poseerla, y este
 * paquete no la importa por ningún lado. Inicia sesión y devuelve el cliente autenticado;
 * a partir de ahí toda lectura pasa por la RLS del rol `device`, y toda escritura por las
 * RPCs `SECURITY DEFINER` acotadas al JWT (`reserve_printed_self`, `device_heartbeat`).
 */
export async function createDeviceClient(creds: AgentCredentials): Promise<SupabaseClient> {
  const client = createClient(creds.supabaseUrl, creds.anonKey, {
    auth: { autoRefreshToken: true, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  });
  if (error) throw error;
  return client;
}
