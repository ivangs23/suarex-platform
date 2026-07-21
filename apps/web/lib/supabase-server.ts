import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de servidor con la sesión del personal, basado en cookies. Usa la
 * anon key: RLS acota lo que ve, exactamente igual que en el navegador.
 */
export async function staffServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        for (const item of items) cookieStore.set(item.name, item.value, item.options);
      },
    },
  });
}

export type StaffSession = { userId: string; tenantId: string };

/**
 * Devuelve la sesión del personal, o null. El `tenant_id` se lee del CLAIM del
 * JWT, no de una cabecera ni de un parámetro: es lo único que el usuario no
 * puede falsificar.
 */
export async function getStaffSession(): Promise<StaffSession | null> {
  const client = await staffServerClient();
  const { data } = await client.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;

  const tenantId = claims.tenant_id;
  if (typeof tenantId !== "string") return null;

  return { userId: claims.sub as string, tenantId };
}
