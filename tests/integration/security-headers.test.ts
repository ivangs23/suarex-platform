import { describe, expect, it } from "vitest";
import { bloquesDeSitio, leerCaddyfile, lineas, snippet } from "./helpers/caddyfile.js";

/**
 * Cabeceras de seguridad en `deploy/Caddyfile`: viven en el snippet `(cabeceras)`, y
 * `(seguridad)` las pone en la respuesta normal y en `handle_errors`. Test estructural.
 */

const caddyfile = leerCaddyfile();
const cabeceras = lineas(snippet(caddyfile, "cabeceras"));
const seguridad = snippet(caddyfile, "seguridad");
const sitios = bloquesDeSitio(caddyfile);

describe("deploy/Caddyfile: cabeceras de seguridad", () => {
  it.each([
    'X-Frame-Options "DENY"',
    `Content-Security-Policy "frame-ancestors 'none'"`,
    'X-Content-Type-Options "nosniff"',
    'Strict-Transport-Security "{args[0]}"',
    "-Server",
  ])("el snippet `cabeceras` lleva %s", (cabecera) => {
    expect(cabeceras).toContain(cabecera);
  });

  it("no hay bloques header fuera del snippet", () => {
    // Uno suelto en un sitio no llegaría a sus respuestas de error.
    expect([...caddyfile.matchAll(/^\s*header\s*\{/gm)]).toHaveLength(1);
  });

  it("`seguridad` las pone en la respuesta normal Y en los errores de Caddy", () => {
    // Las respuestas de error (502, 413) Caddy las compone de cero: sin `handle_errors` salen
    // sin cabeceras y con `Server: Caddy`.
    const errores = seguridad.match(/handle_errors\s*\{([\s\S]*?)\n\t\}/)?.[1] ?? "";
    const fuera = seguridad.replace(errores, "");
    expect(lineas(fuera)).toContain("import cabeceras {args[0]}");
    expect(lineas(errores)).toContain("import cabeceras {args[0]}");
    expect(lineas(errores)).toContain('respond "" {err.status_code}');
  });

  it("los dos sitios importan `seguridad`; HSTS con subdominios solo en la plataforma", () => {
    // Un bloque de sitio nuevo tiene que decidir sus cabeceras: que este número cambie obliga a
    // pasar por aquí.
    expect(sitios).toHaveLength(2);
    const importDe = (b: { cuerpo: string }) =>
      lineas(b.cuerpo).filter((l) => l.startsWith("import seguridad "));
    const plataforma = sitios.find((b) => b.cabecera.includes("{$PLATFORM_DOMAIN}"));
    const propios = sitios.find((b) => b.cabecera === ":443");
    expect(plataforma && importDe(plataforma)).toEqual([
      'import seguridad "max-age=31536000; includeSubDomains"',
    ]);
    // Los demás subdominios de un dominio propio son del cliente: HSTS no puede imponérselos.
    expect(propios && importDe(propios)).toEqual(['import seguridad "max-age=31536000"']);
  });
});
