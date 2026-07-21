import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente para el NAVEGADOR. Usa exclusivamente la anon key y depende de RLS
 * para acotar lo que ve cada usuario.
 *
 * Este paquete existe separado de `@suarex/db` precisamente para que no pueda
 * arrastrar código de servidor: `@suarex/db` lee `SUPABASE_SERVICE_ROLE_KEY`, y
 * un import descuidado desde un componente de cliente podría acabar metiendo esa
 * clave en el bundle. Aquí eso es imposible porque este paquete no la conoce.
 *
 * NUNCA añadas a este paquete nada que lea una clave de servicio.
 */
export function createBrowserClient(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) throw new Error("URL y anon key son obligatorias");
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
