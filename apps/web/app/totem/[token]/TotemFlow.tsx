"use client";

import { pickupCodeFromToken } from "@suarex/domain";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Strings } from "@/lib/i18n";
import { CartPanelHost } from "../../[mesa]/cart/CartPanelHost";
import { CartProvider, useCart } from "../../[mesa]/cart/CartProvider";
import { PaytefPaymentStep } from "./PaytefPaymentStep";
import styles from "./totem.module.css";

/**
 * EL ENVOLTORIO DEL TOTEM: los pasos que rodean a la carta.
 *
 * La carta (el tema del cliente, pasada como `children`) es el fondo, SIEMPRE en el DOM. Encima,
 * a pantalla completa, van los pasos del totem: bienvenida -> para llevar / en mesa -> (mesa) ->
 * carta -> pago por datáfono -> recogida. Es funcionalidad genérica, pintada con la marca del
 * cliente (los colores salen de las variables `--color-*` que el layout ya inyecta por tenant).
 *
 * REGLA de composición, para no perder el estado del flujo al navegar la carta: la carta se
 * mueve por URL (`?cat=`), y cada categoría es una carga de página nueva que borra el estado de
 * React. Por eso el paso vive en `sessionStorage` (como el carrito) y los overlays se pintan solo
 * en cliente, tras hidratar: así una pulsación de categoría no parpadea la bienvenida.
 */

type Step = "welcome" | "mode" | "table" | "menu";
type Mode = "takeaway" | "dine-in";
type FlowState = { step: Step; mode: Mode | null; tableLabel: string | null };

export function TotemFlow({
  token,
  businessName,
  hasHero,
  locale,
  currency,
  strings,
  children,
}: {
  token: string;
  businessName: string;
  /** El cliente subió foto de bienvenida: si no, la bienvenida cae al color de marca. */
  hasHero: boolean;
  locale: string;
  currency: string;
  strings: Strings;
  children: ReactNode;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [flow, setFlow] = useState<FlowState>({ step: "welcome", mode: null, tableLabel: null });
  const storageKey = `suarex_totem_${token}`;

  // El paso se restaura de `sessionStorage` tras montar (en el servidor no existe). Hasta
  // entonces no se pinta ningún overlay: se ve la carta, y no parpadea la bienvenida al navegar.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<FlowState>;
        if (saved && typeof saved.step === "string") {
          setFlow({
            step: saved.step,
            mode: saved.mode ?? null,
            tableLabel: saved.tableLabel ?? null,
          });
        }
      }
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(flow));
    } catch {
      // Sin almacenamiento el flujo sigue dentro de una misma pantalla; solo deja de sobrevivir
      // a la navegación de la carta. No es motivo para romper el totem.
    }
  }, [flow, hydrated, storageKey]);

  // La mesa la elige el comensal en el flujo, así que el `totem` que ve el carrito cambia cuando
  // se teclea. Memoizado por (token, mesa) para no rehacer `checkout` en cada render.
  const totem = useMemo(() => ({ token, tableLabel: flow.tableLabel }), [token, flow.tableLabel]);

  return (
    <CartProvider locale={locale} currency={currency} canOrder strings={strings} totem={totem}>
      {children}
      <TotemChrome
        hydrated={hydrated}
        flow={flow}
        setFlow={setFlow}
        businessName={businessName}
        hasHero={hasHero}
        strings={strings}
        basePath={`/totem/${token}`}
        onReset={() => {
          try {
            window.sessionStorage.removeItem(storageKey);
          } catch {
            // ignorar
          }
        }}
      />
    </CartProvider>
  );
}

/**
 * Los overlays del totem. Vive DENTRO de `CartProvider` porque el pago y la recogida dependen del
 * carrito (`cart.paytefPago`). Orden de prioridad: recogida (ya pagado) > pago > pasos previos >
 * carta (sin overlay). Vaciar el carrito y volver a empezar recarga la ruta: pizarra limpia.
 */
function TotemChrome({
  hydrated,
  flow,
  setFlow,
  businessName,
  hasHero,
  strings: t,
  basePath,
  onReset,
}: {
  hydrated: boolean;
  flow: FlowState;
  setFlow: (next: FlowState) => void;
  businessName: string;
  hasHero: boolean;
  strings: Strings;
  basePath: string;
  onReset: () => void;
}) {
  const cart = useCart();
  const [paid, setPaid] = useState<{ tableLabel: string | null; pickup: string } | null>(null);

  // Hasta hidratar no se sabe el paso: solo la carta de fondo, sin overlay.
  if (!hydrated || !cart) return null;

  // RECOGIDA (pedido pagado). Gana a todo lo demás.
  if (paid) {
    return (
      <section className={styles.overlay} data-testid="totem-done">
        <span className={styles.brand}>{businessName}</span>
        <h1 className={styles.title}>{t.totemCollect}</h1>
        {paid.tableLabel ? (
          <p className={styles.subtitle} data-testid="totem-done-table">
            {t.totemTableNumber}: <strong>{paid.tableLabel}</strong>
          </p>
        ) : (
          <>
            <p className={styles.subtitle}>{t.totemPickupNumber}</p>
            <p className={styles.pickup} data-testid="totem-done-pickup">
              {paid.pickup}
            </p>
          </>
        )}
        <button
          type="button"
          className={styles.bigButton}
          data-testid="totem-new-order"
          onClick={() => {
            // Pizarra limpia para el siguiente comensal: se vacía el carrito, se borra el flujo y
            // se recarga la ruta base (vuelve a la bienvenida, sin arrastrar nada del anterior).
            cart.clearCart();
            onReset();
            window.location.href = basePath;
          }}
        >
          {t.totemNewOrder}
        </button>
      </section>
    );
  }

  // PAGO por datáfono (hay pedido creado a la espera de cobro).
  if (cart.paytefPago) {
    const publicToken = cart.paytefPago.publicToken;
    return (
      <PaytefPaymentStep
        onApproved={() => {
          setPaid({
            tableLabel: flow.tableLabel,
            pickup: pickupCodeFromToken(publicToken),
          });
        }}
      />
    );
  }

  // BIENVENIDA.
  if (flow.step === "welcome") {
    return (
      <section
        className={hasHero ? styles.overlayHero : styles.overlay}
        data-testid="totem-welcome"
      >
        <span className={styles.brand}>{businessName}</span>
        <button
          type="button"
          className={styles.bigButton}
          data-testid="totem-start"
          onClick={() => setFlow({ ...flow, step: "mode" })}
        >
          {t.totemStart}
        </button>
      </section>
    );
  }

  // PARA LLEVAR / EN MESA.
  if (flow.step === "mode") {
    return (
      <section className={styles.overlay} data-testid="totem-mode">
        <span className={styles.brand}>{businessName}</span>
        <div className={styles.choiceGrid}>
          <button
            type="button"
            className={styles.choice}
            data-testid="totem-takeaway"
            onClick={() => setFlow({ ...flow, mode: "takeaway", tableLabel: null, step: "menu" })}
          >
            {t.totemTakeaway}
          </button>
          <button
            type="button"
            className={styles.choice}
            data-testid="totem-dinein"
            onClick={() => setFlow({ ...flow, mode: "dine-in", step: "table" })}
          >
            {t.totemDineIn}
          </button>
        </div>
      </section>
    );
  }

  // NÚMERO DE MESA (solo "en mesa").
  if (flow.step === "table") {
    return (
      <TableStep
        strings={t}
        onBack={() => setFlow({ ...flow, mode: null, step: "mode" })}
        onConfirm={(label) => setFlow({ ...flow, tableLabel: label, step: "menu" })}
      />
    );
  }

  // CARTA: sin overlay. El botón del pedido lo pone el tema; el panel, `CartPanelHost`.
  return <CartPanelHost />;
}

/**
 * Teclado numérico para la mesa (1–100). Mismo rango que valida el servidor
 * (`/api/kiosko/orders`), comprobado aquí también para no dejar avanzar con un número imposible.
 */
function TableStep({
  strings: t,
  onBack,
  onConfirm,
}: {
  strings: Strings;
  onBack: () => void;
  onConfirm: (label: string) => void;
}) {
  const [value, setValue] = useState("");
  const n = Number(value);
  const valido = value !== "" && Number.isInteger(n) && n >= 1 && n <= 100;

  const pulsa = useCallback((digito: string) => {
    setValue((prev) => {
      const next = (prev + digito).replace(/^0+/, "");
      // Máx 3 cifras y nunca por encima de 100: teclear más no sirve de nada.
      if (next.length > 3) return prev;
      if (Number(next) > 100) return prev;
      return next;
    });
  }, []);

  return (
    <section className={styles.overlay} data-testid="totem-table">
      <h1 className={styles.title}>{t.totemEnterTable}</h1>
      <p className={styles.display} data-testid="totem-table-display">
        {value || "—"}
      </p>
      <div className={styles.keypad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            className={styles.key}
            data-testid={`totem-key-${d}`}
            onClick={() => pulsa(d)}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          className={styles.key}
          data-testid="totem-key-back"
          aria-label={t.totemDelete}
          onClick={() => setValue((prev) => prev.slice(0, -1))}
        >
          ⌫
        </button>
        <button
          type="button"
          className={styles.key}
          data-testid="totem-key-0"
          onClick={() => pulsa("0")}
        >
          0
        </button>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.ghostButton}
          data-testid="totem-table-back"
          onClick={onBack}
        >
          {t.totemBack}
        </button>
        <button
          type="button"
          className={styles.bigButton}
          data-testid="totem-table-next"
          disabled={!valido}
          onClick={() => valido && onConfirm(String(n))}
        >
          {t.totemNext}
        </button>
      </div>
    </section>
  );
}
