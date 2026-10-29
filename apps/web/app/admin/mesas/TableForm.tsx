import type { VenueRow } from "@suarex/db";
import { createTableAction } from "./actions";

/**
 * Alta de mesa. Formulario de servidor puro (`createTableAction`, envuelto en
 * `managerAction`). Con una sola sede, `venue_id` viaja oculto y quien gestiona no tiene
 * que saber qué es una sede; con varias, elige en cuál, con la de por defecto marcada.
 */
export function TableForm({
  venues,
  defaultVenueId,
}: {
  venues: VenueRow[];
  defaultVenueId: string;
}) {
  return (
    <form action={createTableAction}>
      <h3>Nueva mesa</h3>
      {venues.length > 1 ? (
        <>
          <label htmlFor="table-venue">Sede</label>
          <select id="table-venue" name="venue_id" defaultValue={defaultVenueId} required>
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </>
      ) : (
        <input type="hidden" name="venue_id" value={defaultVenueId} />
      )}

      <label htmlFor="table-label">Etiqueta</label>
      <input id="table-label" name="label" type="text" required />

      <label htmlFor="table-sort-order">Orden</label>
      <input id="table-sort-order" name="sort_order" type="number" step="1" min="0" />

      <button type="submit">Crear mesa</button>
    </form>
  );
}
