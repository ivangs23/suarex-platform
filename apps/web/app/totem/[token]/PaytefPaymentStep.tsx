"use client";

import { useState } from "react";
import { getTotemBridge, type TotemPayResult } from "@/lib/totem-bridge";
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
 */
export function PaytefPaymentStep({ onApproved }: { onApproved: () => void }) {
  const cart = useCart();
  const [phase, setPhase] = useState<"idle" | "paying" | "declined">("idle");
  const [reason, setReason] = useState<string | null>(null);

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
    if (result.ok) {
      onApproved();
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
