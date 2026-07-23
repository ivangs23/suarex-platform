"use client";

import { type CartProduct, useCart } from "./CartProvider";
import styles from "./cart.module.css";

/**
 * Botón de añadir con sus extras. Lo pinta CADA tema dentro de su tarjeta de producto: dónde
 * cae y qué aspecto tiene es cosa del tema, pero que exista no lo es -- lo comprueba
 * `themes/contract.test.tsx`.
 *
 * Sin proveedor (o sin haber escaneado el QR) no pinta nada: la carta sigue siendo
 * consultable, pero no se puede pedir desde una mesa que no se ha escaneado.
 */
export function AddToCart({ product }: { product: CartProduct }) {
  const cart = useCart();
  if (!cart?.canOrder) return null;

  const unidades = cart.quantities[product.id] ?? 0;
  const elegidas = cart.selectedExtras[product.id] ?? [];

  return (
    <div className={styles.add}>
      {product.extras.length > 0 ? (
        <ul className={styles.extras} data-testid="extras-list">
          {product.extras.map((extra) => (
            <li key={extra.id}>
              <label className={styles.extra}>
                <input
                  type="checkbox"
                  data-testid="extra-checkbox"
                  data-extra-id={extra.id}
                  checked={elegidas.includes(extra.id)}
                  onChange={() => cart.toggleExtra(product.id, extra.id)}
                />
                {extra.name} (+{extra.priceLabel})
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        className={styles.addButton}
        data-testid="add-to-cart"
        data-product-id={product.id}
        onClick={() => cart.add(product)}
      >
        Añadir
        {unidades > 0 ? <span className={styles.badge}>{unidades}</span> : null}
      </button>
    </div>
  );
}
