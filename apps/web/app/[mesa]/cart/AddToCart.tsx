"use client";

import { useState } from "react";
import type { MenuProduct } from "../menu-view";
import { useCart } from "./CartProvider";
import styles from "./cart.module.css";
import { ProductSheet } from "./ProductSheet";

/**
 * Puerta a la ficha del producto, dentro de la tarjeta. La coloca CADA tema donde encaje en
 * su diseño, pero que exista no es opcional -- lo comprueba `themes/contract.test.tsx`.
 *
 * NO lleva contador. Cada vez que se pide un plato se crea una LÍNEA propia, porque el mismo
 * croissant puede ir una vez con york y otra sin nada: un "2" en la tarjeta no diría cuál de
 * las dos formas se está sumando, y el botón menos no sabría a cuál quitarle. Las cantidades
 * se ajustan donde cada línea existe por separado y se ve lo que la distingue: el panel del
 * pedido.
 *
 * Sin haber escaneado el QR no pinta nada: la carta sigue consultable, pero no se pide desde
 * una mesa en la que no estás sentado.
 */
export function AddToCart({ product }: { product: MenuProduct }) {
  const cart = useCart();
  const [fichaAbierta, setFichaAbierta] = useState(false);

  if (!cart?.canOrder) return null;

  return (
    <div className={styles.add}>
      <button
        type="button"
        className={styles.addButton}
        data-testid="open-product-sheet"
        data-product-id={product.id}
        onClick={() => setFichaAbierta(true)}
      >
        {cart.strings.addCustomize}
      </button>

      {fichaAbierta ? (
        <ProductSheet product={product} onClose={() => setFichaAbierta(false)} />
      ) : null}
    </div>
  );
}
