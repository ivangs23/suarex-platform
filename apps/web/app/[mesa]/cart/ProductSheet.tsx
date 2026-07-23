"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MenuProduct } from "../menu-view";
import { useCart } from "./CartProvider";
import styles from "./cart.module.css";

/**
 * FICHA DEL PRODUCTO: el paso entre ver un plato y añadirlo al pedido.
 *
 * Enseña lo que el comensal necesita para decidir -- alérgenos declarados, opciones con lo
 * que cuestan, un sitio para pedir algo concreto -- y el precio total ANTES de añadir, no
 * después. Es un paso del flujo, así que lo tienen todos los clientes: los temas deciden
 * cómo se ve, no si existe.
 *
 * Los alérgenos se muestran TAL CUAL los declaró el gestor. Cuando no hay ninguno se dice
 * literalmente eso -- "no hay alérgenos declarados" -- y no "no contiene": la carta no puede
 * afirmar lo segundo, y por eso la ficha remite al personal ante una alergia grave.
 */
export function ProductSheet({ product, onClose }: { product: MenuProduct; onClose: () => void }) {
  const cart = useCart();
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState(1);
  const tituloId = useId();
  const dialogo = useRef<HTMLDivElement>(null);

  // Escape cierra, como cualquier diálogo. Sin esto, en un móvil sin botón atrás visible la
  // única salida es la X, y en una mesa se toca fuera antes que buscarla.
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

  const extrasCents = extraIds.reduce((suma, id) => {
    const extra = product.extras.find((e) => e.id === id);
    return suma + (extra?.priceCents ?? 0);
  }, 0);
  const totalCents = (product.priceCents + extrasCents) * quantity;

  const alternar = (extraId: string) => {
    setExtraIds((actual) =>
      actual.includes(extraId) ? actual.filter((id) => id !== extraId) : [...actual, extraId],
    );
  };

  return (
    <div className={styles.overlay} data-testid="product-sheet">
      {/* El fondo cierra al tocarlo, que es lo que se espera de una hoja en un móvil. Es un
          <button> de verdad y no un <div> con onClick: así responde también al teclado y lo
          anuncia un lector de pantalla, en vez de ser una zona muerta para quien no toca. */}
      <button
        type="button"
        className={styles.backdrop}
        data-testid="sheet-backdrop"
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
            {product.name}
          </h2>
          <button
            type="button"
            className={styles.sheetClose}
            data-testid="sheet-close"
            aria-label={t.close}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className={styles.sheetBody}>
          {product.description ? (
            <p className={styles.sheetDescription}>{product.description}</p>
          ) : null}

          <section>
            <h3 className={styles.sheetSection}>{t.allergensTitle}</h3>
            {product.allergens.length > 0 ? (
              <ul className={styles.allergens} data-testid="sheet-allergens">
                {product.allergens.map((allergen) => (
                  <li key={allergen.id} className={styles.allergen}>
                    {allergen.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.sheetNote} data-testid="sheet-allergens-empty">
                {t.allergensEmpty}
              </p>
            )}
          </section>

          {product.extras.length > 0 ? (
            <section>
              <h3 className={styles.sheetSection}>{t.optionsTitle}</h3>
              <ul className={styles.options}>
                {product.extras.map((extra) => (
                  <li key={extra.id}>
                    <label className={styles.option}>
                      <input
                        type="checkbox"
                        data-testid="extra-checkbox"
                        data-extra-id={extra.id}
                        checked={extraIds.includes(extra.id)}
                        onChange={() => alternar(extra.id)}
                      />
                      <span className={styles.optionName}>{extra.name}</span>
                      {extra.priceCents > 0 ? (
                        <span className={styles.optionPrice}>+{extra.priceLabel}</span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3 className={styles.sheetSection}>{t.notesTitle}</h3>
            <textarea
              className={styles.notes}
              data-testid="sheet-notes"
              rows={2}
              maxLength={280}
              value={notes}
              onChange={(evento) => setNotes(evento.target.value)}
              aria-label={t.notesLabel}
            />
            {/* La carta no puede responder de una alergia grave: lo dice y remite a alguien
                que sí puede. */}
            <p className={styles.sheetNote}>{t.allergensWarning}</p>
          </section>
        </div>

        <footer className={styles.sheetFoot}>
          <div className={styles.stepper}>
            <button
              type="button"
              className={styles.step}
              data-testid="sheet-less"
              aria-label="Quitar una unidad"
              onClick={() => setQuantity((actual) => Math.max(1, actual - 1))}
            >
              −
            </button>
            <span className={styles.units} data-testid="sheet-units">
              {quantity}
            </span>
            <button
              type="button"
              className={styles.step}
              data-testid="sheet-more"
              aria-label="Añadir una unidad"
              onClick={() => setQuantity((actual) => actual + 1)}
            >
              +
            </button>
          </div>

          <p className={styles.sheetTotal}>
            <span className={styles.sheetTotalLabel}>{t.totalPrice}</span>
            <span data-testid="sheet-total">{cart.formatCents(totalCents)}</span>
          </p>

          <button
            type="button"
            className={styles.pay}
            data-testid="sheet-add"
            onClick={() => {
              cart.addLine(product, { extraIds, notes, quantity });
              onClose();
            }}
          >
            {t.addToOrder}
          </button>
        </footer>
      </div>
    </div>
  );
}
