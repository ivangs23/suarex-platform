export type TenantHostRef =
  | { kind: "subdomain"; slug: string }
  | { kind: "domain"; domain: string };

const RESERVED_SUBDOMAINS = new Set(["www", "api", "admin", "app"]);

export function parseTenantHost(host: string, rootDomains: string[]): TenantHostRef | null {
  const clean = host.trim().toLowerCase().split(":")[0];
  if (!clean) return null;

  for (const root of rootDomains) {
    const normalizedRoot = root.toLowerCase();
    if (clean === normalizedRoot) return null;
    if (!clean.endsWith(`.${normalizedRoot}`)) continue;

    const prefix = clean.slice(0, -(normalizedRoot.length + 1));
    if (!prefix || prefix.includes(".")) return null;
    if (RESERVED_SUBDOMAINS.has(prefix)) return null;
    return { kind: "subdomain", slug: prefix };
  }

  return { kind: "domain", domain: clean };
}
