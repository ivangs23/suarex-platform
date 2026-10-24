import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Lectura estructural de `deploy/Caddyfile` para los tests que lo vigilan (cabeceras, tope del
 * cuerpo). No levanta Caddy: en el VPS se comprueba con los `curl` de `deploy/README.md` §7.
 */

export function leerCaddyfile(): string {
  return readFileSync(path.resolve(import.meta.dirname, "../../../deploy/Caddyfile"), "utf8");
}

/** Bloques de primer nivel (`cabecera {` ... `}` en la columna 0). */
function bloques(caddyfile: string): { cabecera: string; cuerpo: string }[] {
  return [...caddyfile.matchAll(/^([^#\s{][^\n]*?)[ \t]*\{\r?\n([\s\S]*?)^\}/gm)].map((m) => ({
    cabecera: m[1] ?? "",
    cuerpo: m[2] ?? "",
  }));
}

/** Bloques de sitio: ni las opciones globales (`{` solo) ni los snippets (`(nombre) {`). */
export function bloquesDeSitio(caddyfile: string): { cabecera: string; cuerpo: string }[] {
  return bloques(caddyfile).filter((b) => !b.cabecera.startsWith("("));
}

/** Cuerpo del snippet `(nombre)`, o `""` si no existe. */
export function snippet(caddyfile: string, nombre: string): string {
  return bloques(caddyfile).find((b) => b.cabecera === `(${nombre})`)?.cuerpo ?? "";
}

/** Líneas con contenido, sin sangría ni comentarios. */
export function lineas(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0 && !linea.startsWith("#"));
}
