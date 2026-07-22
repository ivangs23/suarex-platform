import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

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
 *
 * FIX (ronda 2): antes construía el cliente con `createClient` de
 * `@supabase/supabase-js` y `persistSession: true`, que guarda la sesión en
 * `localStorage`. El servidor (`apps/web/lib/supabase-server.ts`, `proxy.ts`)
 * lee la sesión de COOKIES vía `@supabase/ssr`. Nunca coincidían: un login
 * real en el navegador guardaba una sesión que el servidor jamás podía ver,
 * `getStaffSession()` devolvía `null` siempre y `/staff` redirigía a
 * `/staff/login` en bucle -- ver `tests/e2e/staff-auth.spec.ts`, que reproduce
 * esto con un login real de principio a fin.
 *
 * La solución: usar el propio `createBrowserClient` de `@supabase/ssr` (ya
 * dependencia de `apps/web`), que persiste la sesión en cookies con el mismo
 * formato que `@supabase/ssr` lee en el servidor. Se mantiene aquí, en vez de
 * moverlo a `apps/web/app/staff/login/page.tsx`, para seguir teniendo un único
 * sitio responsable de "cómo se construye un cliente de navegador" -- la
 * razón de ser original de este paquete (ver docstring de arriba) no depende
 * de qué SDK concreto arma el cliente, y duplicar esta lógica en `apps/web`
 * sería precisamente el tipo de "un sitio más para acordarse" que el resto de
 * este código evita a propósito (mismo principio que `resolveStaffSession`).
 *
 * Es importante que el canal de Realtime (`subscribeToOrders`) reciba ESTE
 * mismo cliente -- no uno nuevo -- para que la suscripción viaje autenticada:
 * `createBrowserClient` de `@supabase/ssr` cachea un singleton en el navegador
 * (ver su código fuente), así que llamarlo de nuevo desde donde sea que se
 * monte el futuro tablero de comandas devuelve la MISMA instancia ya
 * autenticada por el login, sin que el caller tenga que pasarla a mano.
 */
export function createBrowserClient(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) throw new Error("URL y anon key son obligatorias");
  return createSsrBrowserClient(url, anonKey);
}
