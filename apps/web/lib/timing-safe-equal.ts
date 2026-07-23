import { timingSafeEqual } from "node:crypto";

/**
 * Compara dos cadenas en tiempo constante. Una comparación normal (`===`, o `==`) corta en
 * cuanto encuentra el primer carácter distinto, y ese tiempo filtra cuántos caracteres
 * iniciales acertó quien llama -- suficiente para adivinar un secreto carácter a carácter si
 * no rota. `timingSafeEqual` de Node no tiene ese sesgo.
 *
 * Longitudes distintas devuelven `false` sin comparar (Node lanza si difieren): revelar solo
 * "no mide igual" no da ninguna pista útil sobre el contenido.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
