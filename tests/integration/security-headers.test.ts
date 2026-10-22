import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cabeceras anti-clickjacking en `deploy/Caddyfile`. Test estructural: lee el fichero, no
 * levanta Caddy. En el VPS se comprueba con `curl -I`.
 */

const CADDYFILE = path.resolve(import.meta.dirname, "../../deploy/Caddyfile");

/** Líneas (sin comentarios) de cada bloque `header { ... }`. */
function bloquesHeader(caddyfile: string): string[][] {
  return [...caddyfile.matchAll(/^\s*header\s*\{\r?\n([\s\S]*?)^\s*\}/gm)].map((m) =>
    (m[1] ?? "")
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter((linea) => linea.length > 0 && !linea.startsWith("#")),
  );
}

describe("deploy/Caddyfile: nadie enmarca la web", () => {
  const bloques = bloquesHeader(readFileSync(CADDYFILE, "utf8"));

  it("hay exactamente dos bloques header: plataforma y dominios propios", () => {
    // Un bloque de sitio nuevo tiene que decidir sus cabeceras: que este número cambie obliga a
    // pasar por aquí.
    expect(bloques).toHaveLength(2);
    // Ancla: si el parser dejara de leer los bloques, falla aquí en vez de pasar en falso.
    for (const bloque of bloques) {
      expect(bloque.some((linea) => linea.startsWith("Strict-Transport-Security"))).toBe(true);
    }
  });

  it.each([
    'X-Frame-Options "DENY"',
    `Content-Security-Policy "frame-ancestors 'none'"`,
  ])("los dos bloques llevan %s", (cabecera) => {
    // Sin esto, cero bloques leídos pasaría el bucle sin comprobar nada.
    expect(bloques).toHaveLength(2);
    for (const bloque of bloques) expect(bloque).toContain(cabecera);
  });
});
