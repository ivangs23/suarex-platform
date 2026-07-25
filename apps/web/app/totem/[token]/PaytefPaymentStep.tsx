"use client";

import { useEffect, useState } from "react";
import { getTotemBridge, readPrinterStatus, type TotemPayResult } from "@/lib/totem-bridge";
import { useCart } from "../../[mesa]/cart/CartProvider";
import styles from "./totem.module.css";

/**
 * EL COBRO POR DATÁFONO, a pantalla completa del totem.
 *
 * `checkout` ya creó el pedido (`pending`, canal kiosko) y dejó `cart.paytefPago`. Aquí se pide
 * al agente que lo cobre (`window.totem.pay`, ver `lib/totem-bridge`): el importe lo relee el
 * agente del SERVIDOR, no se lo pasamos nosotros. Aprobado -> `onApproved` (pantalla de recogida);
 * rechazado -> se puede reintentar o cancelar y volver al pedido.
 *
 * Sin puente (`window.totem` ausente: un navegador normal, no un totem) no se finge un cobro: se
 * dice que el datáfono no está disponible. En e2e la prueba inyecta su propio puente.
 *
 * Antes de cobrar se mira la impresora de recibos (#15). Un aviso, NO un bloqueo: el código de
 * recogida sale en pantalla, así que sin papel el pedido sigue siendo perfectamente válido y
 * negar la venta por eso sería peor que hacerla. Lo que no vale es que el cliente se entere
 * DESPUÉS de pagar, cuando ya no puede decidir nada.
 */
export function PaytefPaymentStep({ onApproved }: { onApproved: (sinRecibo: boolean) => void }) {
  const cart = useCart();
  const [phase, setPhase] = useState<"idle" | "paying" | "declined" | "in-doubt">("idle");
  /** `true` solo con evidencia de avería: `unknown` (fuera de un totem, o sin agente) no avisa. */
  const [sinRecibo, setSinRecibo] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  /** Código de autorización cuando el cobro quedó en duda: es lo que permite al personal casarlo
   *  con el cierre del datáfono, así que tiene que estar a la vista. */
  const [authCode, setAuthCode] = useState<string | null>(null);

  // Se consulta al entrar en el cobro y no antes: es el último instante en que el dato todavía
  // sirve para algo, y el más fresco. No toca la red -- el agente contesta con lo que ya sabía.
  useEffect(() => {
    let vigente = true;
    readPrinterStatus().then((estado) => {
      if (vigente) setSinRecibo(estado.status === "down");
    });
    return () => {
      vigente = false;
    };
  }, []);

  if (!cart?.paytefPago) return null;
  const t = cart.strings;
  const { orderId, totalCents } = cart.paytefPago;
  const totalLabel = cart.formatCents(totalCents);

  const bridge = getTotemBridge();

  // Fuera de un totem no hay datáfono. Es un fallo de despliegue, no del comensal: se le dice y
  // puede volver al pedido (que sigue `pending`, sin cobrar).
  if (!bridge) {
    return (
      <section className={styles.overlay} data-testid="totem-pay">
        <p className={styles.error} role="alert" data-testid="totem-pay-unavailable">
          {t.orderError}
        </p>
        <button type="button" className={styles.ghostButton} onClick={cart.cancelarPago}>
          {t.totemBack}
        </button>
      </section>
    );
  }

  async function pagar() {
    const b = getTotemBridge();
    if (!b) return;
    setPhase("paying");
    setReason(null);
    let result: TotemPayResult;
    try {
      result = await b.pay(orderId);
    } catch {
      // El puente falló (IPC caído): se trata como rechazo reintentable, sin cobrar a ciegas.
      setReason(t.totemDeclined);
      setPhase("declined");
      return;
    }
    if (result.status === "paid") {
      onApproved(sinRecibo);
      return;
    }
    if (result.status === "in-doubt") {
      /* El cliente YA HA PAGADO. Aquí no se ofrece reintentar bajo ningún concepto: sería cobrarle
         dos veces. Se le pide que avise al personal y se enseña el código de autorización. */
      setAuthCode(result.authCode || null);
      setReason(result.reason);
      setPhase("in-doubt");
      return;
    }
    setReason(result.reason || t.totemDeclined);
    setPhase("declined");
  }

  if (phase === "paying") {
    return (
      <section className={styles.overlay} data-testid="totem-pay">
        <span className={styles.spinner} aria-hidden="true" />
        <h1 className={styles.title}>{t.totemPaying}</h1>
        <p className={styles.subtitle}>{t.totemFollowTerminal}</p>
        <p className={styles.payTotal}>{totalLabel}</p>
      </section>
    );
  }

  /* EN DUDA: cobrado pero sin registrar. Pantalla deliberadamente SIN salida ni reintento -- no
     hay nada que el cliente pueda hacer por su cuenta que no sea pagar dos veces. Se queda aquí
     con el código a la vista hasta que llega alguien del local. */
  if (phase === "in-doubt") {
    return (
      <section className={styles.overlay} data-testid="totem-pay">
        <h1 className={styles.title}>{t.totemInDoubt}</h1>
        <p className={styles.subtitle}>{t.totemInDoubtBody}</p>
        {authCode ? (
          <>
            <p className={styles.subtitle}>{t.totemAuthCode}</p>
            <p className={styles.pickup} data-testid="totem-pay-authcode">
              {authCode}
            </p>
          </>
        ) : null}
        {reason ? (
          <p className={styles.error} role="alert" data-testid="totem-pay-indoubt">
            {reason}
          </p>
        ) : null}
      </section>
    );
  }

  if (phase === "declined") {
    return (
      <section className={styles.overlay} data-testid="totem-pay">
        <h1 className={styles.title}>{t.totemDeclined}</h1>
        {reason ? (
          <p className={styles.error} role="alert" data-testid="totem-pay-error">
            {reason}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.ghostButton}
            data-testid="totem-pay-cancel"
            onClick={cart.cancelarPago}
          >
            {t.totemCancel}
          </button>
          <button
            type="button"
            className={styles.bigButton}
            data-testid="totem-pay-retry"
            onClick={pagar}
          >
            {t.totemRetry}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.overlay} data-testid="totem-pay">
      <h1 className={styles.title}>{t.totemPayAtTerminal}</h1>
      <p className={styles.payTotal} data-testid="totem-pay-total">
        {totalLabel}
      </p>
      {sinRecibo ? (
        <p className={styles.notice} data-testid="totem-no-receipt">
          {t.totemNoReceiptWarning}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.ghostButton}
          data-testid="totem-pay-back"
          onClick={cart.cancelarPago}
        >
          {t.totemBack}
        </button>
        <button
          type="button"
          className={styles.bigButton}
          data-testid="totem-pay-start"
          onClick={pagar}
        >
          {t.totemPayAtTerminal}
        </button>
      </div>
    </section>
  );
}
