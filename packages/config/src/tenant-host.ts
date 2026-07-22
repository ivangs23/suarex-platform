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

/** Límite del nombre de dominio completo (RFC 1035) y de cada etiqueta entre puntos. */
const MAX_DOMAIN_LENGTH = 253;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normaliza y valida el dominio propio de un cliente (`tenants.custom_domain`), p. ej.
 * `garumvinoteca.com`. Devuelve el dominio ya normalizado, o `null` si no vale.
 *
 * Esto NO es cosmético: lo que se guarde aquí acaba decidiendo dos cosas delicadas.
 *
 * 1. **Qué certificados pide Caddy.** El endpoint `ask` (`/api/tls-check`) consulta esta
 *    columna para decidir si emite un certificado on-demand. Un valor basura hace que
 *    Caddy pida certificados imposibles contra Let's Encrypt y agote sus límites, dejando
 *    a TODOS los clientes sin poder renovar.
 * 2. **Qué tenant sirve un Host.** `findTenantByHost` busca por esta columna.
 *
 * Se rechaza a propósito cualquier dominio bajo un dominio raíz de la plataforma. Hoy no
 * permite secuestrar nada (`parseTenantHost` mira las raíces ANTES y resuelve por slug,
 * y las reservadas caen a 404), pero guardarlo dejaría una fila que no sirve para nada,
 * pediría certificados que el comodín ya cubre, y convertiría cualquier cambio futuro en
 * el orden de esa resolución en un secuestro entre clientes. Se corta en el borde.
 */
export function normalizeCustomDomain(value: string, rootDomains: string[]): string | null {
  const clean = value.trim().toLowerCase();

  if (!clean || clean.length > MAX_DOMAIN_LENGTH) return null;
  // Un esquema, una ruta, un puerto, credenciales o un espacio significan que esto no es
  // un nombre de host: se rechaza en vez de intentar rescatar algo de dentro. Aceptar
  // "https://ejemplo.com/carta" recortándolo esconde el error del owner hasta que el
  // certificado falla en producción.
  if (/[\s/\\:@?#]/.test(clean)) return null;

  const labels = clean.split(".");
  // Hace falta al menos un punto: `localhost` o un nombre suelto de red interna no puede
  // llevar certificado público ni resolverse desde fuera.
  if (labels.length < 2) return null;
  if (!labels.every((label) => LABEL.test(label))) return null;

  // Un TLD todo numérico delata una IP escrita como dominio (`192.168.1.10`).
  const tld = labels[labels.length - 1] ?? "";
  if (/^[0-9]+$/.test(tld)) return null;

  for (const root of rootDomains) {
    const normalizedRoot = root.trim().toLowerCase();
    if (!normalizedRoot) continue;
    if (clean === normalizedRoot || clean.endsWith(`.${normalizedRoot}`)) return null;
  }

  return clean;
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
