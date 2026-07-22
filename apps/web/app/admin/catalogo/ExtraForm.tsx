import { createExtraAction } from "./actions";

type ProductOption = { id: string; name: string };

/**
 * Alta de extra. Mismo patrón que `CategoryForm`: formulario de servidor puro, sin
 * estado de React -- `action={createExtraAction}` (`actions.ts`, envuelto en
 * `managerAction`) ya hace todo el trabajo. `product_id` es un select porque un extra
 * SIEMPRE cuelga de un producto concreto (`product_extras.product_id`, ver
 * `20260721000002_catalog.sql`), nunca de una categoría.
 */
export function ExtraForm({ products }: { products: ProductOption[] }) {
  return (
    <form action={createExtraAction}>
      <h3>Nuevo extra</h3>

      <label htmlFor="extra-product">Producto</label>
      <select id="extra-product" name="product_id" required>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>

      <label htmlFor="extra-name">Nombre del extra</label>
      <input id="extra-name" name="name_es" type="text" required />

      <label htmlFor="extra-price">Precio del extra (€)</label>
      <input id="extra-price" name="price" type="number" step="0.01" min="0" required />

      <button type="submit">Crear extra</button>
    </form>
  );
}
