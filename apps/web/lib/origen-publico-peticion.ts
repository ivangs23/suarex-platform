import { getTenantCustomDomain } from "@suarex/db";
import { headers } from "next/headers";
import { cache } from "react";
import { origenPublico } from "./origen-publico";

/**
 * Origen público del cliente para ESTA petición. Es el único sitio que lee el Host y el
 * dominio propio para esto: QR, canonical, sitemap, robots y JSON-LD salen de aquí. `cache`:
 * los metadatos y el render de la carta lo piden los dos, y el dominio se lee una vez.
 */
export const origenPublicoDeLaPeticion = cache(
  async (tenantId: string): Promise<{ origen: string; dominioPropio: string | null }> => {
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
  },
);
