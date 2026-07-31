import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveStaffSession, type StaffSession } from "./staff-session";
import type { ResolvedTenant } from "./tenant-context";

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
        /* Escribir cookies desde un Server Component LANZA en Next: la respuesta ya se está
         * transmitiendo y no hay cabeceras que modificar. Y aquí se acaba escribiendo sin
         * querer: cuando el access token ha caducado, `getClaims()` lo rota y auth-js intenta
         * guardar el nuevo par de cookies. Sin este try/catch, el panel devolvía un 500 --
         * "Cookies can only be modified in a Server Action or Route Handler" -- a la primera
         * visita después de una hora, en vez de servir la página.
         *
         * Tragarlo es lo correcto, no un parche: quien SÍ puede escribir esas cookies es
         * `proxy.ts`, que refresca la sesión en cada petición a `/staff` antes de llegar
         * aquí (ver `refreshStaffSession`). Esta ruta es la de un token ya refrescado ahí, o
         * la de una petición que se refrescará en la siguiente. Nada de autorización depende
         * de que esta escritura ocurra: `resolveStaffSession` sigue leyendo el claim
         * verificado y fallando cerrado si no vale.
         *
         * Lo que NO se hace es dejar el `setAll` vacío: en un Route Handler o una Server
         * Action, donde sí se puede escribir, la rotación tiene que persistirse. */
        try {
          for (const item of items) cookieStore.set(item.name, item.value, item.options);
        } catch {
          // Componente de servidor: no se puede escribir. Ver arriba.
        }
      },
    },
  });
}

export type { StaffSession };

/**
 * SECURITY: obtiene la sesión del personal para el tenant resuelto por Host,
 * o `null`. Es el único punto de entrada de producción a `resolveStaffSession`
 * (ver su docstring en `./staff-session.ts` para el invariante que hace
 * cumplir, qué devuelve un mismatch de tenant y por qué, y la limitación
 * conocida de cuentas multi-tenant): esta función solo añade el cliente real
 * basado en cookies (`staffServerClient()`), nunca relaja ni repite la lógica
 * de autorización, que vive enteramente en `resolveStaffSession`.
 *
 * El `tenant_id` se lee del CLAIM verificado del JWT (`getClaims()`, nunca
 * `getSession()`), no de una cabecera ni de un parámetro: es lo único que el
 * usuario no puede falsificar.
 */
export async function getStaffSession(hostTenant: ResolvedTenant): Promise<StaffSession | null> {
  const client = await staffServerClient();
  return resolveStaffSession(client, hostTenant);
}
