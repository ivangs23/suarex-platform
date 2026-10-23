/**
 * AGOTADO HOY, el otro filtro de la carta que depende del reloj (el primero son las franjas).
 *
 * Un producto agotado vuelve SOLO a su hora (`unavailable_until`, ver
 * `20260924000001_agotado_hoy.sql`): no hay escritura que avise. Por eso el filtro es puro y se
 * aplica en cada petición, y lo que se lee de la base (y se cachea) no depende de la hora.
 */
export function filtrarAgotados<T extends { unavailableUntil: string | null }>(
  productos: T[],
  ahora: Date,
): T[] {
  const instante = ahora.getTime();
  return productos.filter(
    (p) => p.unavailableUntil == null || new Date(p.unavailableUntil).getTime() <= instante,
  );
}
