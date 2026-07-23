"use client";

import { useEffect, useId, useRef } from "react";
import { useCart } from "./CartProvider";
import styles from "./cart.module.css";

/**
 * EL PEDIDO, ANTES DE PAGARLO.
 *
 * Sin esto, lo último que veía el comensal era una cifra suelta: no podía comprobar qué
 * estaba a punto de pagar, ni quitar el plato que sobraba, ni releer la nota que escribió.
 * Pagar a ciegas es justo donde se llama al camarero -- y donde se pierde la venta.
 *
 * Enseña cada línea como se pidió (extras y nota incluidas, que es lo que la distingue de
 * otra línea del mismo plato), deja cambiar cantidades y quitar, y remata con el total.
 *
 * Lo pinta la página, no el tema: es el paso del dinero, y un tema que se lo saltara dejaría
 * a ese cliente sin forma de revisar el pedido.
 */
export function CartPanel({ onClose }: { onClose: () => void }) {
  const cart = useCart();
  const tituloId = useId();
  const dialogo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onClose();
    };
    window.addEventListener("keydown", alPulsar);
    dialogo.current?.focus();
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onClose]);

  if (!cart) return null;
  const t = cart.strings;

  return (
    <div className={styles.overlay} data-testid="cart-panel">
      <button
        type="button"
        className={styles.backdrop}
        data-testid="cart-panel-backdrop"
        aria-label={t.close}
        onClick={onClose}
      />
      <div
        className={styles.sheet}
        ref={dialogo}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
      >
        <header className={styles.sheetHead}>
          <h2 className={styles.sheetTitle} id={tituloId}>
            {t.yourOrder}
          </h2>
          <button
            type="button"
            className={styles.sheetClose}
            data-testid="cart-panel-close"
            aria-label={t.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className={styles.sheetBody}>
          {cart.lines.length === 0 ? (
            <p className={styles.sheetNote} data-testid="cart-empty">
              {t.cartEmpty}
            </p>
          ) : (
            <ul className={styles.lines}>
              {cart.lines.map((line) => {
                // Las extras se enseñan por su NOMBRE, no por su id: la línea tiene que
                // poder revisarse a simple vista, que es para lo que existe este panel.
                const extras = line.extraIds
                  .map((id) => line.product.extras.find((extra) => extra.id === id)?.name)
                  .filter(Boolean);

                return (
                  <li key={line.id} className={styles.line} data-testid="cart-line">
                    <div className={styles.lineText}>
                      <span className={styles.lineName}>{line.product.name}</span>
                      {extras.length > 0 ? (
                        <span className={styles.lineDetail} data-testid="cart-line-extras">
                          {extras.join(" · ")}
                        </span>
                      ) : null}
                      {line.notes ? (
                        <span className={styles.lineDetail} data-testid="cart-line-notes">
                          “{line.notes}”
                        </span>
                      ) : null}
                      <span className={styles.linePrice}>
                        {cart.formatCents(line.unitCents * line.quantity)}
                      </span>
                    </div>

                    <div className={styles.stepper}>
                      <button
                        type="button"
                        className={styles.step}
                        data-testid="cart-line-less"
                        aria-label={`Quitar una unidad de ${line.product.name}`}
                        onClick={() => cart.setLineQuantity(line.id, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span className={styles.units} data-testid="cart-line-units">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        className={styles.step}
                        data-testid="cart-line-more"
                        aria-label={`Añadir una unidad de ${line.product.name}`}
                        onClick={() => cart.setLineQuantity(line.id, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className={styles.sheetFoot}>
          <p className={styles.sheetTotal}>
            <span className={styles.sheetTotalLabel}>{t.total}</span>
            <span data-testid="cart-panel-total">{cart.totalLabel}</span>
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
            disabled={cart.enviando || cart.totalCents === 0}
            onClick={cart.checkout}
          >
            {cart.enviando ? t.sending : t.pay}
          </button>
        </footer>
      </div>
    </div>
  );
}
