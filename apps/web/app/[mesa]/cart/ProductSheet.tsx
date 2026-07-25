"use client";

import { isSelectionComplete } from "@suarex/domain";
import { useId, useRef, useState } from "react";
import type { MenuOptionGroup, MenuProduct } from "../menu-view";
import { useCart } from "./CartProvider";
import styles from "./cart.module.css";
import { useDialog } from "./useDialog";

/**
 * La regla de un grupo, en una frase corta al lado de su nombre.
 *
 * Tres formas y no una plantilla única porque son tres cosas distintas para quien lee: "Elige 1"
 * es una obligación, "Hasta 2, opcional" es un permiso, y el rango es lo que queda en medio. Con
 * un solo texto genérico ("min 1, max 1") el comensal tiene que traducirlo él.
 */
function reglaDelGrupo(
  minSelect: number,
  maxSelect: number,
  t: { optionsChooseExact: string; optionsChooseRange: string; optionsChooseUpTo: string },
): string {
  const rellena = (plantilla: string) =>
    plantilla.replace("{min}", String(minSelect)).replace("{max}", String(maxSelect));
  if (minSelect === 0) return rellena(t.optionsChooseUpTo);
  if (minSelect === maxSelect) return rellena(t.optionsChooseExact);
  return rellena(t.optionsChooseRange);
}

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
 *
 * Los GRUPOS de opciones (#16) van antes que los añadidos sueltos y llevan sus reglas escritas
 * ("Elige 1"). Mientras falte algo obligatorio, "Añadir" está deshabilitado y se dice qué falta:
 * un botón que no responde sin explicación es peor que uno que no está. Quien decide si la
 * selección vale es `isSelectionComplete` (@suarex/domain), la MISMA función que aplica el
 * servidor al crear el pedido -- así la pantalla nunca puede permitir algo que luego se rechace,
 * ni al revés.
 */
export function ProductSheet({ product, onClose }: { product: MenuProduct; onClose: () => void }) {
  const cart = useCart();
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState(1);
  const tituloId = useId();
  const dialogo = useRef<HTMLDivElement>(null);

  // Escape cierra, el foco se atrapa dentro y vuelve al abrir/cerrar. Ver `useDialog`.
  useDialog(dialogo, onClose);

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

  /* Elegir dentro de un grupo con tope 1 SUSTITUYE, no acumula: es una elección, no una lista.
     Sin esto, tocar "Al punto" después de "Poco hecha" dejaría las dos marcadas y el botón
     bloqueado por pasarse -- y el comensal sin entender por qué, porque acababa de cambiar de
     idea, que es lo más normal del mundo. */
  const elegirEnGrupo = (group: MenuOptionGroup, extraId: string) => {
    setExtraIds((actual) => {
      if (actual.includes(extraId)) return actual.filter((id) => id !== extraId);
      if (group.maxSelect === 1) {
        const delGrupo = new Set(group.options.map((o) => o.id));
        return [...actual.filter((id) => !delGrupo.has(id)), extraId];
      }
      return [...actual, extraId];
    });
  };

  const grupos = product.optionGroups.map((group) => ({
    ...group,
    elegidas: group.options.reduce((n, o) => n + (extraIds.includes(o.id) ? 1 : 0), 0),
  }));
  const completo = isSelectionComplete(
    product.optionGroups.map((group) => ({
      id: group.id,
      name: group.name,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      optionIds: group.options.map((o) => o.id),
    })),
    extraIds,
  );

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

          {/* GRUPOS primero: son elecciones, no añadidos, y un menú del día se lee en el orden
              en que se compone. Cada uno dice su regla en la propia cabecera. */}
          {grupos.map((group) => (
            <section key={group.id} data-testid="option-group" data-group-id={group.id}>
              <h3 className={styles.sheetSection}>
                {group.name}
                <span className={styles.groupRule} data-testid="option-group-rule">
                  {reglaDelGrupo(group.minSelect, group.maxSelect, t)}
                </span>
              </h3>
              <ul className={styles.options}>
                {group.options.map((option) => (
                  <li key={option.id}>
                    <label className={styles.option}>
                      {/* `radio` cuando solo cabe una: es lo que dice, sin leer nada, que elegir
                          otra sustituye a la anterior. Con `name` propio por grupo para que dos
                          grupos del mismo producto no se pisen. */}
                      <input
                        type={group.maxSelect === 1 ? "radio" : "checkbox"}
                        name={group.maxSelect === 1 ? `grupo-${group.id}` : undefined}
                        data-testid="extra-checkbox"
                        data-extra-id={option.id}
                        checked={extraIds.includes(option.id)}
                        /* Con el grupo lleno, lo que ya no se puede es AÑADIR más; quitar sigue
                           disponible, o el comensal se quedaría encerrado en su elección. */
                        disabled={
                          group.maxSelect > 1 &&
                          group.elegidas >= group.maxSelect &&
                          !extraIds.includes(option.id)
                        }
                        onChange={() => elegirEnGrupo(group, option.id)}
                      />
                      <span className={styles.optionName}>{option.name}</span>
                      {option.priceCents > 0 ? (
                        <span className={styles.optionPrice}>+{option.priceLabel}</span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {product.looseExtras.length > 0 ? (
            <section>
              <h3 className={styles.sheetSection}>{t.optionsTitle}</h3>
              <ul className={styles.options}>
                {product.looseExtras.map((extra) => (
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

          {/* Se dice QUÉ falta, no solo que no se puede. Un botón apagado sin motivo hace que
              el comensal toque tres veces y se vaya. */}
          {!completo ? (
            <p className={styles.sheetNote} role="status" data-testid="sheet-missing">
              {t.optionsRequiredHint}
            </p>
          ) : null}
          <button
            type="button"
            className={styles.pay}
            data-testid="sheet-add"
            disabled={!completo}
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
