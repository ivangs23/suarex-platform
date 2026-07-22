"use client";

/**
 * Muestra el `<svg>` del QR de una mesa y un botón que imprime esa misma vista
 * (`window.print()` -- el navegador imprime lo que ya está en pantalla, no se genera un
 * PDF ni se sube nada a ningún sitio).
 *
 * `svg` llega YA COMPUESTO por el servidor (`page.tsx`, Server Component): la URL que
 * codifica (`{origin}/m/{token}`) se construye ahí a partir del Host de la petición
 * (`headers()`, nunca de un input del cliente) y del `token` de la mesa (generado por la
 * base, ver `packages/db/src/admin-tables.ts`), y se dibuja con `tableQrSvg`
 * (`apps/web/lib/qr.ts`, librería `qrcode`). `dangerouslySetInnerHTML` es seguro
 * PRECISAMENTE por eso: el navegador nunca ve una cadena que él mismo (o quien ataque)
 * controle, solo el marcado SVG que produjo esa librería sobre una entrada 100%
 * servidor -- mismo razonamiento que ya aplica `app/layout.tsx` para las variables CSS
 * del branding del tenant.
 */
export function QrView({ svg, label }: { svg: string; label: string }) {
  return (
    <div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG compuesto en el
      servidor (tableQrSvg sobre una URL Host+token, nunca input del cliente), ver
      docstring de arriba -- mismo razonamiento que app/layout.tsx aplica para las
      variables CSS del branding. */}
      <div data-testid="table-qr" dangerouslySetInnerHTML={{ __html: svg }} />
      <button type="button" onClick={() => window.print()}>
        Imprimir QR de la mesa {label}
      </button>
    </div>
  );
}
