import type { MetadataRoute } from "next";
import { origenPublicoDeLaPeticion } from "@/lib/origen-publico-peticion";
import { reglasDeRobots } from "@/lib/rastreo";
import { requireTenant } from "@/lib/tenant-context";

/** Por host. Solo llegan aquí el de un cliente y, sin tenant, el de plataforma (`proxy.ts`). */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await requireTenant().catch(() => null);
  if (!tenant) return reglasDeRobots(null);
  const { origen } = await origenPublicoDeLaPeticion(tenant.id);
  return reglasDeRobots(origen);
}
