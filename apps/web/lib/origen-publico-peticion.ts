import { getTenantCustomDomain } from "@suarex/db";
import { headers } from "next/headers";
import { origenPublico } from "./origen-publico";

/**
 * Origen público del cliente para ESTA petición. Es el único sitio que lee el Host y el
 * dominio propio para esto: QR, canonical, sitemap y robots salen de aquí.
 */
export async function origenPublicoDeLaPeticion(
  tenantId: string,
): Promise<{ origen: string; dominioPropio: string | null }> {
  const [headerList, dominioPropio] = await Promise.all([
    headers(),
    getTenantCustomDomain(tenantId),
  ]);
  const origen = origenPublico({
    customDomain: dominioPropio,
    host: headerList.get("host") ?? "",
    forwardedProto: headerList.get("x-forwarded-proto"),
  });
  return { origen, dominioPropio };
}
