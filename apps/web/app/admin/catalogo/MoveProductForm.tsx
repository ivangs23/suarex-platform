import { moveProductAction } from "./actions";

type Opcion = { id: string; name: string; depth: number };

/**
 * Mueve UN producto a otra categoría y/o cambia su orden dentro de ella.
 *
 * Va dentro del `<details>` de edición, así que se renderiza una vez por producto listado.
 * Es asumible porque la lista está acotada a 60 (`MAX_ITEMS`), no a los 184: por eso el
 * tope no era solo cuestión de altura de página, también de cuántas opciones caben en el
 * DOM. Con los 184 serían ~10.800 opciones; con 60, unas 3.500.
 *
 * Está SEPARADO de `ProductEditForm` a propósito. Son dos formularios distintos porque son
 * dos gestos distintos: corregir un precio es rutina, y sacar un plato de su categoría es
 * una decisión sobre la estructura de la carta. Mezclarlos haría fácil mover algo sin
 * querer al guardar un cambio de nombre.
 */
export function MoveProductForm({
  productId,
  currentCategoryId,
  sortOrder,
  options,
}: {
  productId: string;
  currentCategoryId: string;
  sortOrder: number;
  options: Opcion[];
}) {
  return (
    <form action={moveProductAction} data-testid="move-product-form">
      <input type="hidden" name="product_id" value={productId} />

      <label>
        Categoría
        <select name="category_id" defaultValue={currentCategoryId}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {`${"— ".repeat(o.depth)}${o.name}`}
            </option>
          ))}
        </select>
      </label>

      {/* "Posición en la lista" y no "Orden dentro de la categoría": `getByLabel` hace
          subcadena sin distinguir mayúsculas, así que esa etiqueta casaría también con el
          `<select>` de "Categoría" justo encima y el localizador devolvería dos elementos. */}
      <label>
        Posición en la lista
        <input name="sort_order" type="number" step="1" defaultValue={sortOrder} />
      </label>

      <button type="submit">Mover producto</button>
    </form>
  );
}
