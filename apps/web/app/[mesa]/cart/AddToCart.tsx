"use client";

import { useState } from "react";
import type { MenuProduct } from "../menu-view";
import { useCart } from "./CartProvider";
import styles from "./cart.module.css";
import { ProductSheet } from "./ProductSheet";

/**
 * Control de pedido de una tarjeta de producto. Lo pinta CADA tema dentro de su tarjeta:
 * dónde cae y qué aspecto tiene es cosa del tema, pero que exista no lo es -- lo comprueba
 * `themes/contract.test.tsx`.
 *
 * Dos caminos a propósito:
 *
 *   "Añadir / personalizar" abre la FICHA, que es donde están los alérgenos, las opciones
 *   y las notas. Es el camino principal: un café con leche de avena no se puede pedir
 *   desde un botón suelto.
 *
 *   El contador aparece cuando ya hay unidades de ese producto, para subir y bajar sin
 *   volver a abrir nada. Corregir un plato añadido de más tiene que poder hacerse donde se
 *   añadió; obligar a abrir la ficha para quitar uno es donde el comensal se rinde.
 *
 * Sin haber escaneado el QR no pinta nada: la carta sigue consultable, pero no se pide desde
 * una mesa en la que no estás sentado.
 */
export function AddToCart({ product }: { product: MenuProduct }) {
  const cart = useCart();
  const [fichaAbierta, setFichaAbierta] = useState(false);

  if (!cart?.canOrder) return null;

  const unidades = cart.unitsOf(product.id);
  const t = cart.strings;

  return (
    <div className={styles.add}>
      {unidades > 0 ? (
        <div className={styles.stepper}>
          <button
            type="button"
            className={styles.step}
            data-testid="remove-from-cart"
            data-product-id={product.id}
            aria-label={`Quitar una unidad de ${product.name}`}
            onClick={() => cart.removeOne(product.id)}
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
            onClick={() => cart.addOne(product)}
          >
            +
          </button>
        </div>
      ) : null}

      <button
        type="button"
        className={styles.addButton}
        data-testid="open-product-sheet"
        data-product-id={product.id}
        onClick={() => setFichaAbierta(true)}
      >
        {unidades > 0 ? t.customize : t.addCustomize}
      </button>

      {fichaAbierta ? (
        <ProductSheet product={product} onClose={() => setFichaAbierta(false)} />
      ) : null}
    </div>
  );
}
