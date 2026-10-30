import { createClient } from "@supabase/supabase-js";

/**
 * Entra en Auth como lo hace la app de escritorio y devuelve solo los tokens, sin guardar la
 * sesión ni renovarla: quien los use es `/api/sesion`.
 */
export async function tokensDe(
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Faltan SUPABASE_URL/SUPABASE_ANON_KEY en .env.test. Corre `pnpm db:env`.");
  }
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
}
