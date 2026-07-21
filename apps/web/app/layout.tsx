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
  const settings = tenant ? await getTenantSettings(tenant.id) : null;
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
