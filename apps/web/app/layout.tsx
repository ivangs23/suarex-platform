import { brandingToCssVars, parseBranding } from "@suarex/config";
import { Inter, Playfair_Display } from "next/font/google";
import type { ReactNode } from "react";
import { settingsDeLaCarta } from "@/lib/carta-cache";
import { requireTenant } from "@/lib/tenant-context";
import "./globals.css";

/**
 * Fuentes que la plataforma carga para TODOS los clientes: una serif de display y una sans
 * de texto, expuestas como variables CSS (`--font-playfair`, `--font-inter`). Cargarlas aquí
 * (next/font, self-hosted) evita una petición a Google Fonts en runtime y el salto de layout
 * del FOUT.
 *
 * `branding.fonts` elige ENTRE ESTAS (y la del sistema): `brandingToCssVars` emite
 * `--font-display`/`--font-body` apuntando a una de estas variables. Una familia que no se
 * cargue aquí no se puede elegir en el panel.
 */
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-playfair",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export default async function RootLayout({ children }: { children: ReactNode }) {
  // requireTenant() lanza cuando el middleware no resolvió tenant para esta ruta:
  // exactamente lo que ocurre en los rewrites internos a /not-found y /suspended
  // (proxy.ts no fija las cabeceras x-suarex-tenant-* en esos dos casos, a
  // propósito). Este layout envuelve todas las rutas de la app, incluidas esas
  // dos, así que debe degradar a la marca por defecto en vez de lanzar: de lo
  // contrario un host desconocido o un tenant suspendido responderían 500 en
  // lugar de los 404/503 que exige el rewrite.
  const tenant = await requireTenant().catch(() => null);
  // getTenantSettings() can throw after tenant resolution already succeeded
  // (e.g. the DB becomes unreachable between the middleware's Host lookup and
  // this render). That is NOT a resolution failure -- we already know which
  // tenant owns this Host -- so it is deliberately treated as a degradation,
  // not an error: fall back to `null` the same way "no settings row yet"
  // already does below via `parseBranding(undefined)`.
  //
  // A hard 503 is not available here even if we wanted a stricter posture:
  // the App Router's only status-fallback mechanism from a Server Component
  // (`notFound()`/`forbidden()`/`unauthorized()`) is hardcoded to 404/403/401
  // (see next/dist/client/components/http-access-fallback), so a layout can
  // never itself emit an arbitrary status like 503 -- an uncaught throw here
  // just becomes a generic 500, which is the one outcome that's definitely
  // wrong. Letting it degrade to default branding instead is deliberate and
  // bounded: it only ever masks *branding*, never which tenant is served
  // (`data-tenant` below still reflects the real, already-resolved tenant).
  // Los mismos ajustes cacheados que lee la carta: una sola lectura entre los dos, y la
  // misma invalidación al guardar en el panel.
  const settings = tenant ? await settingsDeLaCarta(tenant.id).catch(() => null) : null;
  const branding = parseBranding(settings?.branding);

  return (
    <html
      lang={settings?.locale ?? "es"}
      data-tenant={tenant?.slug}
      className={`${playfair.variable} ${inter.variable}`}
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: brandingToCssVars solo emite colores ya validados por parseBranding contra /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/ y literales fijos para fuentes y tokens (enumerados), que no pueden contener `<`, `}` ni comillas. */}
        <style dangerouslySetInnerHTML={{ __html: `:root{${brandingToCssVars(branding)}}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
