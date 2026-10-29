import { hasChannel } from "@suarex/config";
import type { MetadataRoute } from "next";
import { leerCarta, settingsDeLaCarta } from "@/lib/carta-cache";
import { origenPublicoDeLaPeticion } from "@/lib/origen-publico-peticion";
import { urlsDelSitemap } from "@/lib/rastreo";
import { requireTenant } from "@/lib/tenant-context";

/** El de cada cliente. Sin tenant o sin carta por QR (ADR 0009) no hay nada que listar. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await requireTenant().catch(() => null);
  if (!tenant) return [];
  const [{ categories, products }, settings, { origen }] = await Promise.all([
    leerCarta(tenant.id),
    settingsDeLaCarta(tenant.id).catch(() => null),
    origenPublicoDeLaPeticion(tenant.id),
  ]);
  if (!hasChannel(settings?.channels ?? [], "qr-mesa")) return [];
  return urlsDelSitemap({ origen, categorias: categories, productos: products });
}
