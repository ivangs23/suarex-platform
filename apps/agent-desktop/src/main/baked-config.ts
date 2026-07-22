/**
 * Config pública horneada en el build (ver `electron.vite.config.ts`). La anon key es
 * pública por diseño (RLS acota lo que ve cada usuario); el service role JAMÁS llega aquí.
 * `SUPABASE_ORIGIN` es el origin del que cuelga `/api/devices/pair` -- por defecto, el mismo
 * de la web del tenant/plataforma; se deriva de `SUPABASE_URL` si no se hornea aparte.
 */
export const SUPABASE_URL: string = import.meta.env.SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string = import.meta.env.SUPABASE_ANON_KEY ?? "";

/** El endpoint de emparejamiento vive en la web de la plataforma, no en el propio Supabase.
 * Se hornea como `SUPABASE_URL` de la web (p. ej. https://garum.suarex.app) durante el
 * build; en dev, http://garum.localhost:3000. Se toma de una env aparte para no acoplarlo a
 * la URL de Supabase. */
export const PAIR_ENDPOINT_ORIGIN: string = import.meta.env.SUPABASE_URL ?? "";
