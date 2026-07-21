export type TenantHostRef =
  | { kind: "subdomain"; slug: string }
  | { kind: "domain"; domain: string };

const RESERVED_SUBDOMAINS = new Set(["www", "api", "admin", "app"]);

export function parseTenantHost(host: string, rootDomains: string[]): TenantHostRef | null {
  const clean = host.trim().toLowerCase().split(":")[0];
  if (!clean) return null;

  for (const root of rootDomains) {
    const normalizedRoot = root.trim().toLowerCase();
    if (clean === normalizedRoot) return null;
    if (!clean.endsWith(`.${normalizedRoot}`)) continue;

    const prefix = clean.slice(0, -(normalizedRoot.length + 1));
    if (!prefix || prefix.includes(".")) return null;
    if (RESERVED_SUBDOMAINS.has(prefix)) return null;
    return { kind: "subdomain", slug: prefix };
  }

  return { kind: "domain", domain: clean };
}

/**
 * Resuelve `TENANT_ROOT_DOMAINS` a partir de las env vars del proceso, cerrando dos
 * modos de fallo silencioso (fail-closed, no de aislamiento -- pero con un coste de
 * diagnóstico alto):
 *
 * - Sin definir en producción: con el fallback anterior (`?? "localhost"`), todo host
 *   `*.suarex.app` caía a la rama de dominio propio (`parseTenantHost` nunca hacía match
 *   de subdominio contra "localhost") y devolvía 404 para TODOS los tenants, en silencio.
 *   Ahora, fuera de `development`, una variable sin definir (o vacía) lanza en vez de
 *   defaultear.
 * - `"localhost, suarex.app"` (un espacio tras la coma, algo natural de escribir): sin
 *   trim, la raíz `" suarex.app"` no hacía match con ningún host real y 404eaba cada
 *   tenant de subdominio. Aquí se recorta cada entrada y se descartan las vacías (p.ej.
 *   una coma final).
 */
export function resolveRootDomains(env: {
  TENANT_ROOT_DOMAINS?: string;
  NODE_ENV?: string;
}): string[] {
  const raw = env.TENANT_ROOT_DOMAINS;

  if (raw === undefined || raw.trim() === "") {
    if (env.NODE_ENV === "development") return ["localhost"];
    throw new Error(
      "TENANT_ROOT_DOMAINS no está definida. Es obligatoria fuera de development: sin " +
        "ella, todo host de subdominio de tenant cae a la rama de dominio propio y 404ea.",
    );
  }

  const domains = raw
    .split(",")
    .map((domain) => domain.trim())
    .filter((domain) => domain.length > 0);

  if (domains.length === 0) {
    throw new Error("TENANT_ROOT_DOMAINS está definida pero no contiene ningún dominio válido.");
  }

  return domains;
}
