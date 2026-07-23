"use client";

import { CartPanel } from "./CartPanel";
import { useCart } from "./CartProvider";

/**
 * Monta el panel del pedido cuando el comensal lo abre.
 *
 * Lo renderiza la PÁGINA y no el tema, por lo mismo de siempre: es donde se revisa y se paga,
 * y un tema que se lo saltara dejaría a ese cliente sin forma de rematar el pedido. Lo que sí
 * elige el tema es dónde va el botón que lo abre (ver `CartButton`).
 */
export function CartPanelHost() {
  const cart = useCart();
  if (!cart?.panelOpen) return null;
  return <CartPanel onClose={cart.closePanel} />;
}
