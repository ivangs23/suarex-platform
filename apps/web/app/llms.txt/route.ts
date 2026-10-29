import { hasChannel, parseBranding } from "@suarex/config";
import { NextResponse } from "next/server";
import { fichaDeLaCarta, leerCarta, settingsDeLaCarta } from "@/lib/carta-cache";
import { pickI18n, resolveLang } from "@/lib/i18n";
import { textoLlms } from "@/lib/llms";
import { origenPublicoDeLaPeticion } from "@/lib/origen-publico-peticion";
import { requireTenant } from "@/lib/tenant-context";

/** El `llms.txt` de cada cliente (`textoLlms`). Sin tenant (plataforma) o sin carta por QR, 404. */
export async function GET(): Promise<Response> {
  const tenant = await requireTenant().catch(() => null);
  if (!tenant) return new NextResponse(null, { status: 404 });

  const [{ categories, products }, settings, ficha, { origen }] = await Promise.all([
    leerCarta(tenant.id),
    settingsDeLaCarta(tenant.id).catch(() => null),
    fichaDeLaCarta(tenant.id).catch(() => null),
    origenPublicoDeLaPeticion(tenant.id),
  ]);
  if (!hasChannel(settings?.channels ?? [], "qr-mesa")) {
    return new NextResponse(null, { status: 404 });
  }

  const branding = parseBranding(settings?.branding);
  const lang = resolveLang(undefined, settings?.locale);
  const texto = textoLlms({
    businessName: branding.name ?? tenant.slug,
    tagline: branding.tagline[lang] ?? null,
    origen,
    lang,
    categorias: categories.map((c) => ({
      id: c.id,
      slug: c.slug,
      parentId: c.parentId,
      nombre: pickI18n(c.nameI18n, lang, lang) || c.slug,
    })),
    productos: products,
    ficha,
  });
  return new NextResponse(texto, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
