/**
 * Config pública horneada en el build (ver `electron.vite.config.ts`). La anon key es
 * pública por diseño (RLS acota lo que ve cada usuario); el service role JAMÁS llega aquí.
 * `SUPABASE_URL` es el host de la API de Supabase (`https://<proj>.supabase.co`); lo usa
 * `runAgent` (cliente supabase-js real) para hablar con la base de datos/auth.
 */
export const SUPABASE_URL: string = import.meta.env.SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string = import.meta.env.SUPABASE_ANON_KEY ?? "";

/** El endpoint de emparejamiento (`/api/devices/pair`) es una ruta Next.js que vive en el
 * origin de la WEB de la plataforma (p. ej. `https://garum.suarex.app` en prod,
 * `http://garum.localhost:3000` en dev) -- NO en el host de Supabase. Es un origin distinto
 * de `SUPABASE_URL` (host de la API de Supabase) y se hornea a partir de una env de build
 * separada, `PLATFORM_WEB_ORIGIN` (ver `electron.vite.config.ts`), para no acoplar ambos
 * orígenes: reutilizar `SUPABASE_URL` aquí haría que `pairDevice` apuntara al host de
 * Supabase y el emparejamiento fallara siempre (404 -> "invalid-code"). */
export const PAIR_ENDPOINT_ORIGIN: string = import.meta.env.PLATFORM_WEB_ORIGIN ?? "";
