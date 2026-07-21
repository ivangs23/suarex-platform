import { brandingToCssVars, parseBranding } from "@suarex/config";
import { getTenantSettings } from "@suarex/db";
import type { ReactNode } from "react";
import { requireTenant } from "@/lib/tenant-context";
import "./globals.css";

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
  const settings = tenant ? await getTenantSettings(tenant.id).catch(() => null) : null;
  const branding = parseBranding(settings?.branding);

  return (
    <html lang={settings?.locale ?? "es"} data-tenant={tenant?.slug}>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: brandingToCssVars solo emite valores ya validados por parseBranding contra /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/ (colores) y /^[a-zA-Z0-9 ,'-]+$/ (fuentes), que no pueden contener `<`, `}` ni comillas. */}
        <style dangerouslySetInnerHTML={{ __html: `:root{${brandingToCssVars(branding)}}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
