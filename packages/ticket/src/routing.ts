import type { TicketItem } from "./types.js";

const BARRA_KEYWORDS = [
  "vino",
  "cerveza",
  "cana", // "cana" -> "cana con tilde" sin diacritico
  "cafe", // "cafe" sin diacritico
  "copa",
  "coctel", // "coctel" sin diacritico
  "agua",
  "refresco",
  "infusion", // "infusion" sin diacritico
  "champan", // "champan" sin diacritico
  "cava",
  "licor",
  "whisky",
  "whiskey",
  "gintonic",
  "gin",
  "ron",
  "vermut",
  "vermouth",
];

function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * El destino explicito manda. Sin el, se infiere: barra solo si el nombre
 * contiene una palabra de bebida; en caso contrario, cocina. El fallback existe
 * para pedidos sin destino asignado.
 */
export function effectiveDestination(item: TicketItem): "cocina" | "barra" {
  if (item.destination === "cocina" || item.destination === "barra") return item.destination;
  const n = normalize(item.name);
  return BARRA_KEYWORDS.some((kw) => n.includes(kw)) ? "barra" : "cocina";
}

export function filterItems(items: TicketItem[], destination: "cocina" | "barra"): TicketItem[] {
  return items.filter((item) => effectiveDestination(item) === destination);
}
