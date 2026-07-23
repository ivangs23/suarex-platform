"use client";

import { useCart } from "./CartProvider";
import styles from "./cart.module.css";

/**
 * Aviso al pie cuando ESTE navegador no puede pedir: no ha escaneado el QR de la mesa, la
 * cookie caducó (dura una jornada, ver `lib/mesa-cookie.ts`) o está mirando una mesa distinta
 * de la que escaneó. Sin él, la carta se queda muda en modo consulta -- se ve, no se puede
 * pedir -- y quien está sentado no entiende por qué le faltan los botones ni cómo recuperarlos.
 *
 * Lo monta la PÁGINA, no el tema, igual que el panel del pedido: es plataforma, idéntico para
 * todos los clientes. El tema no lo coloca porque no es decoración suya, es la explicación de
 * por qué su carta no deja pedir ahora mismo.
 */
export function ScanToOrderHint() {
  const cart = useCart();
  // Si se puede pedir no hay nada que avisar; tampoco tiene sentido taparlo mientras el
  // comensal revisa o paga el pedido en el panel abierto.
  if (!cart || cart.canOrder || cart.panelOpen) return null;

  return (
    <div className={styles.scanHint} role="status" data-testid="scan-to-order">
      <span aria-hidden="true">📷</span>
      {cart.strings.scanToOrder}
    </div>
  );
}
