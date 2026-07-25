"use client";

import { pickupCodeFromToken } from "@suarex/domain";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Strings } from "@/lib/i18n";
import { CartPanelHost } from "../../[mesa]/cart/CartPanelHost";
import { CartProvider, useCart } from "../../[mesa]/cart/CartProvider";
import { graceSecondsLeft, type IdlePhase, idlePhase } from "./idle";
import { PaytefPaymentStep } from "./PaytefPaymentStep";
import styles from "./totem.module.css";

/** Sin tocar la pantalla durante este tiempo, el totem avisa; tras el margen extra, se reinicia
 *  para el siguiente cliente. Lo bastante largo para leer una carta sin prisa. */
const IDLE_MS = 90_000;
const GRACE_MS = 15_000;
/** Tras recoger, la pantalla de "gracias" vuelve sola a la bienvenida: nadie va a pulsar el botón
 *  cuando ya tiene su comida en la mano. */
const DONE_RETURN_MS = 20_000;

/**
 * Vigila la inactividad del totem con un latido corto: en vez de encadenar temporizadores, mira
 * cuánto hace del último toque. Así un reloj que salta o una pestaña ralentizada no dejan el
 * totem colgado a medio pedido.
 */
function useIdleWatch(enabled: boolean): { phase: IdlePhase; secondsLeft: number } {
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const [phase, setPhase] = useState<IdlePhase>("active");
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    /* Al (re)activar la vigilancia, la cuenta empieza de cero. Sin esto, quien pasa un rato en la
       pantalla del datáfono y luego CANCELA volvería a la carta con el contador ya vencido y se
       encontraría el carrito borrado en el acto. */
    setLastActivity(Date.now());
    const touch = () => setLastActivity(Date.now());
    const eventos = ["pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const evento of eventos) window.addEventListener(evento, touch, { passive: true });
    return () => {
      for (const evento of eventos) window.removeEventListener(evento, touch);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setPhase("active");
      return;
    }
    const id = window.setInterval(() => {
      const transcurrido = Date.now() - lastActivity;
      setPhase(idlePhase(transcurrido, IDLE_MS, GRACE_MS));
      setSecondsLeft(graceSecondsLeft(transcurrido, IDLE_MS, GRACE_MS));
    }, 500);
    return () => window.clearInterval(id);
  }, [enabled, lastActivity]);

  return { phase, secondsLeft };
}

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
  locale,
  currency,
  strings,
  welcomeNode,
  children,
}: {
  token: string;
  businessName: string;
  locale: string;
  currency: string;
  strings: Strings;
  /** La pantalla de bienvenida del TEMA del cliente (la misma que la web). El totem la muestra y
   *  captura el toque para avanzar a "para llevar / en mesa" en vez de ir directo a la carta. */
  welcomeNode: ReactNode;
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

  // Estable a propósito: de esta función cuelga el temporizador de la pantalla de recogida, y una
  // identidad nueva en cada render lo reiniciaría sin llegar a disparar nunca.
  const olvidaFlujo = useCallback(() => {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Sin almacenamiento no hay nada que olvidar.
    }
  }, [storageKey]);

  return (
    <CartProvider locale={locale} currency={currency} canOrder strings={strings} totem={totem}>
      {children}
      <TotemChrome
        hydrated={hydrated}
        flow={flow}
        setFlow={setFlow}
        businessName={businessName}
        welcomeNode={welcomeNode}
        strings={strings}
        basePath={`/totem/${token}`}
        onReset={olvidaFlujo}
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
  welcomeNode,
  strings: t,
  basePath,
  onReset,
}: {
  hydrated: boolean;
  flow: FlowState;
  setFlow: (next: FlowState) => void;
  businessName: string;
  welcomeNode: ReactNode;
  strings: Strings;
  basePath: string;
  onReset: () => void;
}) {
  const cart = useCart();
  const [paid, setPaid] = useState<{ tableLabel: string | null; pickup: string } | null>(null);

  // Pizarra limpia para el siguiente cliente. La misma operación tanto si la pide él como si salta
  // por inactividad, así que vive en un solo sitio. `clearCart` es estable (ver `CartProvider`).
  const clearCart = cart?.clearCart;
  const reiniciaTotem = useCallback(() => {
    clearCart?.();
    onReset();
    window.location.href = basePath;
  }, [clearCart, onReset, basePath]);

  /* La vigilancia de inactividad SOLO corre con un pedido a medias. Nunca durante el cobro -- ahí
     hay dinero en juego y manda el datáfono, no un temporizador nuestro -- ni en la bienvenida,
     donde no hay nada que perder. */
  const enPedido = hydrated && !paid && !cart?.paytefPago && flow.step !== "welcome";
  const { phase, secondsLeft } = useIdleWatch(enPedido);

  useEffect(() => {
    if (enPedido && phase === "expired") reiniciaTotem();
  }, [enPedido, phase, reiniciaTotem]);

  // Tras recoger, la pantalla vuelve sola: nadie pulsa un botón con la comida ya en la mano.
  useEffect(() => {
    if (!paid) return;
    const id = window.setTimeout(reiniciaTotem, DONE_RETURN_MS);
    return () => window.clearTimeout(id);
  }, [paid, reiniciaTotem]);

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
          onClick={reiniciaTotem}
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

  /* ¿SIGUES AHÍ? Alguien dejó el pedido a medias. Se avisa antes de borrar nada -- puede estar
     leyendo la carta con calma -- y cualquier toque en la pantalla cancela el aviso, porque el
     propio escuchador de actividad reinicia la cuenta. */
  if (enPedido && phase === "warning") {
    return (
      <section className={styles.overlay} data-testid="totem-idle-warning">
        <h1 className={styles.title}>{t.totemStillThere}</h1>
        <p className={styles.subtitle}>{t.totemStillThereBody}</p>
        <p className={styles.pickup} data-testid="totem-idle-countdown">
          {secondsLeft}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="totem-idle-startover"
            onClick={reiniciaTotem}
          >
            {t.totemStartOver}
          </button>
          {/* No necesita onClick propio: el toque ya lo recoge el escuchador de actividad y la
              fase vuelve a "active" sola. El botón existe para que se vea qué hacer. */}
          <button type="button" className={styles.bigButton} data-testid="totem-idle-stay">
            {t.totemImHere}
          </button>
        </div>
      </section>
    );
  }

  // BIENVENIDA: la MISMA pantalla que la web (la del tema del cliente, `welcomeNode`). Encima, un
  // capturador transparente a pantalla completa convierte el toque en "avanzar a modo" en vez de
  // ir directo a la carta (que es a donde iría el enlace del tema). Así el aspecto es idéntico al
  // de la web y el flujo del totem sigue siendo el suyo.
  if (flow.step === "welcome") {
    return (
      <div className={styles.welcomeHost} data-testid="totem-welcome">
        {welcomeNode}
        <button
          type="button"
          className={styles.welcomeCatcher}
          data-testid="totem-start"
          aria-label={t.totemStart}
          onClick={() => setFlow({ ...flow, step: "mode" })}
        />
      </div>
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

  /* CARTA: sin overlay, porque la pinta el tema del cliente. Solo se le añade una salida: en la
     carta no hay ningún paso previo al que volver, así que sin esto un cliente que se equivoca de
     modo o quiere empezar de cero no tiene forma de hacerlo salvo esperar a la inactividad. */
  return (
    <>
      <CartPanelHost />
      <button
        type="button"
        className={styles.startOver}
        data-testid="totem-startover"
        onClick={() => {
          if (window.confirm(t.totemStartOverConfirm)) reiniciaTotem();
        }}
      >
        {t.totemStartOver}
      </button>
    </>
  );
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
