import type { Json } from "./database.types.js";

/**
 * Lectura de columnas `jsonb` tipadas como `Json` en `database.types.ts`. Sustituye a los casts
 * a ciegas que daban por hecha su forma: si la base trae otra cosa, se degrada a vacío en vez
 * de reventar en quien lo pinta.
 */

/** Un `jsonb` que se espera objeto (`connection`, `branding`...). Si no lo es, vacío. */
export function objetoJson(valor: Json | null | undefined): { [clave: string]: Json | undefined } {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? valor : {};
}

/** Textos por idioma (`name_i18n`, `name_snapshot`...): solo las claves cuyo valor es texto. */
export function textosJson(valor: Json | null | undefined): Record<string, string> {
  const textos: Record<string, string> = {};
  for (const [idioma, texto] of Object.entries(objetoJson(valor))) {
    if (typeof texto === "string") textos[idioma] = texto;
  }
  return textos;
}
