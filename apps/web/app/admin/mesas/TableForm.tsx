import { createTableAction } from "./actions";

/**
 * Alta de mesa. Formulario de servidor puro, mismo patrón que `CategoryForm`
 * (`app/admin/catalogo/CategoryForm.tsx`): sin estado de React, `action={createTableAction}`
 * (`actions.ts`, envuelto en `managerAction`) ya hace todo el trabajo.
 *
 * `venue_id` viaja como campo oculto, no como un `<select>`: esta fase (D2) no gestiona
 * altas/bajas de locales, así que la pantalla (`page.tsx`) resuelve el local por defecto
 * del tenant vía `listVenues` y lo pasa aquí ya elegido -- quien gestiona no tiene que
 * saber qué es un "local" para dar de alta una mesa.
 */
export function TableForm({ venueId }: { venueId: string }) {
  return (
    <form action={createTableAction}>
      <h3>Nueva mesa</h3>
      <input type="hidden" name="venue_id" value={venueId} />

      <label htmlFor="table-label">Etiqueta</label>
      <input id="table-label" name="label" type="text" required />

      <label htmlFor="table-sort-order">Orden</label>
      <input id="table-sort-order" name="sort_order" type="number" step="1" min="0" />

      <button type="submit">Crear mesa</button>
    </form>
  );
}
