import { headers } from "next/headers";

export type ResolvedTenant = { id: string; slug: string };

// SECURITY: this trusts the mere presence of these two headers. That is only
// safe because `proxy.ts` is the sole writer of them and guarantees, on
// every response path (success via `NextResponse.next({ request: { headers }})`,
// and both error rewrites via the same `request: { headers }` mechanism with
// the tenant headers explicitly deleted), that a client-supplied
// `x-suarex-tenant-*` header can never reach this function un-overwritten.
// Format-validating `id`/`slug` here would not add real protection -- a
// forged header for a genuine victim tenant looks exactly like a legitimate
// one -- so the actual control point is, and must remain, `proxy.ts`. If you
// add a new response path there, it MUST go through the same header-override
// mechanism or this function's trust assumption breaks silently.
export async function requireTenant(): Promise<ResolvedTenant> {
  const headerList = await headers();
  const id = headerList.get("x-suarex-tenant-id");
  const slug = headerList.get("x-suarex-tenant-slug");

  if (!id || !slug) {
    throw new Error("Tenant no resuelto: el middleware no se ejecutó para esta ruta");
  }

  return { id, slug };
}
