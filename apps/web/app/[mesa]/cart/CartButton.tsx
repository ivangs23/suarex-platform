"use client";

import { useCart } from "./CartProvider";
import styles from "./cart.module.css";

/**
 * Puerta al pedido. La coloca CADA tema donde encaje en su diseño -- la bolsa de la cabecera
 * en Manuela, la barra de abajo en el genérico -- pero que exista no es opcional: sin ella,
 * ese cliente tendría una carta en la que se puede añadir y no se puede pagar. Lo comprueba
 * `themes/contract.test.tsx`.
 *
 * El panel que abre lo pinta la página, no el tema: es el paso del dinero.
 */
export function CartButton({ className }: { className?: string }) {
  const cart = useCart();
  if (!cart?.canOrder) return null;

  return (
    <button
      type="button"
      className={className ?? styles.cartButton}
      data-testid="cart-open"
      onClick={cart.openPanel}
    >
      {cart.strings.yourOrder}
      {cart.totalUnits > 0 ? (
        <span className={styles.badge} data-testid="cart-units-total">
          {cart.totalUnits}
        </span>
      ) : null}
    </button>
  );
}
