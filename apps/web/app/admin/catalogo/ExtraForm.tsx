"use client";

import { useState } from "react";
import { createExtraAction } from "./actions";

type ProductOption = {
  id: string;
  name: string;
  /** Grupos de opciones de ESE producto (#16), para poder crear la extra ya dentro de uno. */
  groups: { id: string; name: string }[];
};

/**
 * Alta de extra. `product_id` es un select porque un extra SIEMPRE cuelga de un producto
 * concreto (`product_extras.product_id`, ver `20260721000002_catalog.sql`), nunca de una
 * categoría.
 *
 * `"use client"` desde #16 y solo por eso: el desplegable de grupo tiene que enseñar los del
 * producto ELEGIDO, no los de los 184. Sin ese filtro, la forma más rápida de romper una carta
 * sería meter "Punto de la carne" en un vino -- y el trigger de la base lo rechazaría, sí, pero
 * con un error de Postgres en la cara en vez de con una lista que no ofrece el disparate.
 *
 * Sin grupo (la opción vacía, y la única cuando el producto no tiene ninguno) el extra es un
 * añadido suelto: opcional y sin reglas, exactamente como antes de que los grupos existieran.
 */
export function ExtraForm({ products }: { products: ProductOption[] }) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const grupos = products.find((product) => product.id === productId)?.groups ?? [];

  return (
    <form action={createExtraAction}>
      <h3>Nuevo extra</h3>

      <label htmlFor="extra-product">Producto</label>
      <select
        id="extra-product"
        name="product_id"
        required
        value={productId}
        onChange={(evento) => setProductId(evento.target.value)}
      >
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </select>

      <label htmlFor="extra-group">Grupo de opciones</label>
      <select id="extra-group" name="group_id" defaultValue="">
        <option value="">Ninguno (extra suelto)</option>
        {grupos.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
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
