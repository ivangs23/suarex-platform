const STATIONS = new Set(["cocina", "barra"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lanzado por `parseMarkStationDoneInput` -- nunca llega a tocar la base de datos. */
export class InvalidStaffOrderInputError extends Error {}

export type MarkStationDoneInput = { orderId: string; station: "cocina" | "barra" };

/**
 * Fix round 2 (Finding 4): valida los dos argumentos que la Server Action
 * `markStationDone` (`app/staff/actions.ts`) recibe directamente del cliente. El tipado
 * `"cocina" | "barra"` de esa función es solo un contrato en tiempo de COMPILACIÓN entre
 * el botón de `OrdersBoard.tsx` y la acción -- un caller que invoque la Server Action
 * directamente (no a través del botón, p. ej. desde las devtools) no pasa por ese
 * tipado y puede enviar cualquier string como `station` o como `orderId`.
 *
 * Sin esta validación:
 *   - un `station` que no fuera exactamente "cocina" caía en el ternario de
 *     `packages/db/src/staff-orders.ts` (`station === "cocina" ? ... : ...`), que lo
 *     enruta SILENCIOSAMENTE a la columna `bar_status` -- un mis-route, no un rechazo.
 *   - un `orderId` que no fuera un UUID llegaba tal cual al `.eq("id", orderId)` de
 *     PostgREST, que lo traduce en un error crudo de casteo de Postgres (`invalid input
 *     syntax for type uuid`, 22P02) en vez de un mensaje limpio y manejable.
 *
 * Devuelve los valores ya estrechados a los tipos que `markStationDone` (el repositorio)
 * espera si ambos son válidos; lanza `InvalidStaffOrderInputError` en caso contrario, en
 * cualquiera de los dos casos, ANTES de que la Server Action llegue a resolver sesión o
 * tocar la base de datos.
 */
export function parseMarkStationDoneInput(orderId: string, station: string): MarkStationDoneInput {
  if (!STATIONS.has(station)) {
    throw new InvalidStaffOrderInputError(`Estación inválida: ${JSON.stringify(station)}`);
  }
  if (!UUID_PATTERN.test(orderId)) {
    throw new InvalidStaffOrderInputError(
      `orderId no es un UUID válido: ${JSON.stringify(orderId)}`,
    );
  }

  return { orderId, station: station as "cocina" | "barra" };
}
