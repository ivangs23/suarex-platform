/**
 * Emoji para el badge de un alérgeno en la tarjeta -- SOLO cuando hay uno inequívoco y de uso
 * común. Un alérgeno mal entendido es un riesgo para el comensal, no un fallo cosmético: un
 * emoji ambiguo (¿🍷 es "sulfitos"? ¿🫘 es "altramuces"?) puede confundir más que ayudar. Para
 * esos, la tarjeta muestra el NOMBRE corto en su lugar, nunca un emoji que induzca a error.
 *
 * En todos los casos, el badge lleva el nombre completo del alérgeno como texto accesible
 * (`title`/`aria-label`), y la lista precisa y completa vive en la ficha del producto.
 */
const EMOJI = {
  wheat: "🌾",
  shrimp: "🦐",
  egg: "🥚",
  fish: "🐟",
  peanut: "🥜",
  milk: "🥛",
  nut: "🌰",
} as Record<string, string>;

/** Emoji del alérgeno, o `null` si no hay uno lo bastante claro para no confundir. */
export function allergenEmoji(icon: string | null): string | null {
  return icon ? (EMOJI[icon] ?? null) : null;
}
