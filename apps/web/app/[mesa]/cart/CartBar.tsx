"use client";

import { useState } from "react";
import { CartPanel } from "./CartPanel";
import { useCart } from "./CartProvider";
import styles from "./cart.module.css";

/**
 * Barra del pedido: cuántas cosas llevas, cuánto suman y la puerta al panel donde se
 * revisa y se paga.
 *
 * La pinta la PÁGINA, no el tema. Es el paso del dinero, y un tema al que se le olvidara
 * dejaría a ese cliente con una carta que no cobra. Los temas la visten con las variables de
 * marca; su sitio (barra fija abajo) es el mismo para todos a propósito.
 *
 * No ocupa nada mientras el carrito está vacío: la carta se navega sin una barra tapando el
 * último plato de cada pantalla.
 *
 * Pagar NO está aquí, sino dentro del panel: el último gesto antes de gastarse el dinero
 * tiene que ocurrir con el pedido a la vista, no junto a una cifra suelta que no dice de qué
 * se compone.
 */
export function CartBar() {
  const cart = useCart();
  const [panelAbierto, setPanelAbierto] = useState(false);

  if (!cart?.canOrder) return null;

  return (
    <>
      {/* La barra solo existe con algo dentro: navegar la carta con una barra vacía tapando
          el último plato de cada pantalla no ayuda a nadie. */}
      {cart.totalCents > 0 ? (
        <div className={styles.bar} data-testid="cart-bar">
          <p className={styles.total} data-testid="cart-total">
            {cart.totalLabel}
          </p>
          <button
            type="button"
            className={styles.pay}
            data-testid="cart-open"
            onClick={() => setPanelAbierto(true)}
          >
            {cart.strings.viewOrder}
            <span className={styles.badge} data-testid="cart-units-total">
              {cart.totalUnits}
            </span>
          </button>
        </div>
      ) : null}

      {/* El panel NO cuelga de que haya algo en el carrito: quitando la última línea desde
          dentro se quedaría sin barra y desaparecería bajo el dedo, sin decir qué ha pasado.
          Abierto y vacío, lo dice y se cierra cuando el comensal quiera. */}
      {panelAbierto ? <CartPanel onClose={() => setPanelAbierto(false)} /> : null}
    </>
  );
}
