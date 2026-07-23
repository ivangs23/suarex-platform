"use client";

import { useCart } from "./CartProvider";
import styles from "./cart.module.css";

/**
 * Resumen del carrito y botón de pagar.
 *
 * Lo pinta la PÁGINA, no el tema. Es lo último que ve el comensal antes de gastarse el
 * dinero, y un tema al que se le olvidara pintarlo dejaría a ese cliente con una carta que
 * no cobra. Los temas lo visten con las variables de marca; su sitio (barra fija abajo) es
 * el mismo para todos a propósito.
 *
 * No ocupa nada mientras el carrito está vacío: la carta se navega sin una barra tapando el
 * último plato de cada pantalla.
 */
export function CartBar() {
  const cart = useCart();
  if (!cart?.canOrder || cart.totalCents === 0) return null;

  return (
    <div className={styles.bar} data-testid="cart-bar">
      <p className={styles.total} data-testid="cart-total">
        {cart.totalLabel}
      </p>
      {cart.error ? (
        <p className={styles.error} role="alert">
          {cart.error}
        </p>
      ) : null}
      <button
        type="button"
        className={styles.pay}
        data-testid="cart-pay"
        disabled={cart.enviando}
        onClick={cart.checkout}
      >
        {cart.enviando ? "Enviando…" : "Pagar"}
      </button>
    </div>
  );
}
