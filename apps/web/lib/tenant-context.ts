import { headers } from "next/headers";

export type ResolvedTenant = { id: string; slug: string };

export async function requireTenant(): Promise<ResolvedTenant> {
  const headerList = await headers();
  const id = headerList.get("x-suarex-tenant-id");
  const slug = headerList.get("x-suarex-tenant-slug");

  if (!id || !slug) {
    throw new Error("Tenant no resuelto: el middleware no se ejecutó para esta ruta");
  }

  return { id, slug };
}
