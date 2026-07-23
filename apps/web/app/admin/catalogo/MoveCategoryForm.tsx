import { moveCategoryAction } from "./actions";

type Opcion = { id: string; name: string; depth: number };

/**
 * Mueve la categoría SELECCIONADA a otro padre y/o cambia su orden.
 *
 * Se renderiza una sola vez por página -- solo para la categoría del filtro -- así que
 * puede permitirse un `<select>` con las 59 categorías. Repetirlo en cada una habría metido
 * 3.500 opciones en el DOM para una acción que se usa de vez en cuando.
 *
 * La propia categoría se excluye de las opciones: no puede ser su propio padre. Sus
 * descendientes SÍ aparecen, y elegirlos se rechaza en el servidor con un mensaje claro
 * (`wouldCreateCycle`) -- filtrarlos aquí exigiría recorrer el árbol en el cliente y
 * duplicaría una regla que de todos modos hay que imponer en el servidor.
 */
export function MoveCategoryForm({
  categoryId,
  currentParentId,
  sortOrder,
  options,
}: {
  categoryId: string;
  currentParentId: string | null;
  sortOrder: number;
  options: Opcion[];
}) {
  return (
    <form action={moveCategoryAction} data-testid="move-category-form">
      <input type="hidden" name="category_id" value={categoryId} />

      <label>
        Colgar de
        <select name="parent_id" defaultValue={currentParentId ?? ""}>
          {/* Cadena vacía = raíz: un `<select>` no puede llevar `null` como valor. */}
          <option value="">— Sin padre (primer nivel) —</option>
          {options
            .filter((o) => o.id !== categoryId)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {`${"— ".repeat(o.depth)}${o.name}`}
              </option>
            ))}
        </select>
      </label>

      <label>
        Orden entre sus hermanas
        <input name="sort_order" type="number" step="1" defaultValue={sortOrder} />
      </label>

      <button type="submit">Mover categoría</button>
    </form>
  );
}
