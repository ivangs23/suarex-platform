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

      {/* Con unidades en el carrito, el botón único da paso al contador. Quitar tiene que
          estar donde se puso: obligar a bajar a la barra del total para corregir un plato
          añadido de más es justo donde el comensal se rinde y llama al camarero. */}
      {unidades === 0 ? (
        <button
          type="button"
          className={styles.addButton}
          data-testid="add-to-cart"
          data-product-id={product.id}
          onClick={() => cart.add(product)}
        >
          Añadir
        </button>
      ) : (
        <div className={styles.stepper}>
          <button
            type="button"
            className={styles.step}
            data-testid="remove-from-cart"
            data-product-id={product.id}
            aria-label={`Quitar una unidad de ${product.name}`}
            onClick={() => cart.remove(product.id)}
          >
            −
          </button>
          <span className={styles.units} data-testid="cart-units" data-product-id={product.id}>
            {unidades}
          </span>
          <button
            type="button"
            className={styles.step}
            data-testid="add-to-cart"
            data-product-id={product.id}
            aria-label={`Añadir una unidad de ${product.name}`}
            onClick={() => cart.add(product)}
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}
