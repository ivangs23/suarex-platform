/**
 * Prepara texto para una impresora termica en codepage 858. Quita diacriticos
 * (e con acento -> e, n con tilde -> n), pliega comillas y guiones
 * tipograficos a ASCII, y sustituye por "?" cualquier caracter fuera de
 * \x20-\xff (emoji incluidos). El euro se conserva porque 858 lo incluye.
 *
 * Los rangos Unicode se escriben con escapes (\u0300-\u036f para las marcas
 * diacriticas combinantes, etc.), nunca como caracteres literales incrustados
 * en el fichero fuente: un literal es fragil frente a cambios de
 * codificacion/editor.
 */
export function sanitizeForThermal(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // marcas diacriticas combinantes
    .replace(/[\u2018\u2019]/g, "'") // comillas simples tipograficas
    .replace(/[\u201c\u201d]/g, '"') // comillas dobles tipograficas
    .replace(/[\u2013\u2014]/g, "-") // guiones en/em
    .replace(/\u2026/g, "...") // puntos suspensivos
    .replace(/[\u{1f000}-\u{1ffff}]/gu, "?") // emoji
    .replace(/[^\x20-\xff\u20ac]/g, "?"); // fuera de latin1, salvo el euro
}
