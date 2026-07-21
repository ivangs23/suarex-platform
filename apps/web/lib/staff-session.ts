import type { ResolvedTenant } from "./tenant-context";

export type StaffSession = { userId: string; tenantId: string };

/**
 * Forma mínima que esta función necesita de un cliente de Auth de Supabase.
 * Deliberadamente estructural (no `SupabaseClient` de `@supabase/supabase-js`,
 * que `apps/web` no puede importar directamente) para que tanto el cliente
 * real de `@supabase/ssr` (`staffServerClient()`) como un cliente de prueba
 * cualquiera la satisfagan sin acoplarse al SDK.
 */
export type StaffAuthClient = {
  auth: {
    getClaims: (
      jwt?: string,
    ) => Promise<
      { data: { claims: Record<string, unknown> }; error: null } | { data: null; error: unknown }
    >;
  };
};

/**
 * SECURITY: única función de autorización para la superficie de personal.
 * Existen dos hechos independientes sobre cualquier petición: a qué tenant
 * pertenece la CUENTA (el claim `tenant_id`, verificado, del JWT) y para qué
 * tenant es la PETICIÓN (`hostTenant`, resuelto por `proxy.ts` a partir del
 * Host y pasado por `requireTenant()` -- ver `tenant-context.ts`). Esta
 * función es la única vía soportada para obtener una sesión de personal
 * precisamente porque exige `hostTenant` como parámetro obligatorio: no existe
 * una variante que devuelva la sesión sin también comprobar que ambos hechos
 * coinciden. Un "helper aparte para acordarse de comprobar también el tenant"
 * es exactamente el patrón que se olvida con el tiempo -- por eso no existe.
 *
 * Todos los casos de fallo -- sin sesión, token expirado, malformado, sin
 * firmar, sin claim `tenant_id`, firma forjada/alterada, Y el mismatch de
 * tenant -- devuelven exactamente el mismo `null`, sin distinguirse entre sí.
 * Esto es intencional: un futuro caller que solo compruebe "¿hay sesión?" no
 * puede aprender de este valor de retorno si el tenant existe, si la cuenta
 * existe, o si simplemente pertenece a otro tenant -- es el comportamiento
 * que menos información revela. El caller SIEMPRE debe tratar `null` como "no
 * autenticado para este tenant" y redirigir a `/staff/login` (nunca renderizar
 * datos de personal cuando esta función devuelve `null`); nunca debe emitir un
 * 403/404 distinto para el caso de mismatch, porque eso sí revelaría que la
 * sesión era válida para otro tenant.
 *
 * LIMITACIÓN conocida: si una cuenta de personal llega a pertenecer a más de
 * un tenant, `custom_access_token_hook` (ver `supabase/migrations`) elige la
 * membership con el `created_at` más antiguo, sin relación alguna con el
 * subdominio desde el que se inició sesión -- `app/staff/login/page.tsx` no
 * ata el login al Host usado. Esta función no resuelve ese caso (queda fuera
 * de alcance de esta ronda), pero sí garantiza que, mientras tanto, una cuenta
 * así sea rechazada (nunca servida en silencio) en cualquier tenant que no
 * sea el que quedó grabado en su token actual.
 */
export async function resolveStaffSession(
  client: StaffAuthClient,
  hostTenant: ResolvedTenant,
  jwt?: string,
): Promise<StaffSession | null> {
  const { data } = await client.auth.getClaims(jwt);
  const claims = data?.claims;
  if (!claims) return null;

  const tenantId = claims.tenant_id;
  if (typeof tenantId !== "string") return null;

  // El invariante que se hace cumplir: el tenant de la CUENTA (este claim)
  // debe coincidir con el tenant de la PETICIÓN (resuelto por Host). Ver el
  // docstring de arriba para qué devuelve un mismatch y por qué.
  if (tenantId !== hostTenant.id) return null;

  const userId = claims.sub;
  if (typeof userId !== "string") return null;

  return { userId, tenantId };
}
