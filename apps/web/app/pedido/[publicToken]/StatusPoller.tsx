"use client";

import type { OrderStatus } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import { useEffect, useState } from "react";
import { orderStatusLabel, type Strings } from "@/lib/i18n";
import styles from "./pedido.module.css";

const POLL_INTERVAL_MS = 5000;

// Estados terminales del pedido (ver CHECK de `orders.status`): una vez aquí ya
// no hay nada más que esperar, así que seguir sondeando cada 5s solo generaría
// tráfico inútil contra el servidor mientras el comensal deje la pestaña
// abierta en la mesa.
const TERMINAL_STATUSES = new Set(["served", "cancelled"]);

/**
 * Sondea `GET /api/pedido/{publicToken}` (el único endpoint del comensal, ver
 * `route.ts` en este mismo directorio) cada `POLL_INTERVAL_MS` para reflejar en
 * pantalla `pending` -> `paid` -> `served` sin recargar. Deliberadamente NO usa
 * Supabase Realtime ni ningún cliente de Supabase: el comensal es anónimo y este
 * sistema no concede RLS a llamadas anónimas (ver brief), así que su navegador
 * nunca debe recibir la clave anon. El tablero de staff (`OrdersBoard.tsx`) sí
 * usa Realtime porque el personal está autenticado.
 */
export function StatusPoller({
  publicToken,
  initialOrder,
  locale,
  strings: t,
}: {
  publicToken: string;
  initialOrder: OrderStatus;
  /** Locale del cliente, para formatear el total. Lo resuelve el servidor (`getOrderLocale`)
   *  y no cambia entre sondeos, así que llega como prop en vez de en la respuesta del API. */
  locale: string;
  /** Textos de la plataforma en el idioma del cliente (estados del pedido, títulos). */
  strings: Strings;
}) {
  const [order, setOrder] = useState(initialOrder);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(order.status)) return;

    let stopped = false;

    const id = setInterval(() => {
      fetch(`/api/pedido/${publicToken}`)
        .then((response) => (response.ok ? (response.json() as Promise<OrderStatus>) : null))
        .then((data) => {
          if (!stopped && data) setOrder(data);
        })
        .catch(() => {
          // Blip de red puntual: se reintenta en el siguiente tick, sin romper
          // la pantalla del comensal por un fallo pasajero de conectividad.
        });
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [publicToken, order.status]);

  const servido = order.status === "served";
  const cancelado = order.status === "cancelled";

  return (
    <section className={styles.card}>
      <p className={styles.number}>
        {t.orderTitle} #{order.orderNumber}
      </p>

      <div
        className={`${styles.badge} ${servido ? styles.done : ""} ${cancelado ? styles.cancelled : ""}`}
        data-testid="order-status"
      >
        {/* Punto que late mientras el pedido sigue en marcha; fijo cuando ya terminó. */}
        {!servido && !cancelado ? <span className={styles.pulse} aria-hidden="true" /> : null}
        {orderStatusLabel(order.status, t)}
      </div>

      <p className={styles.total}>
        <span className={styles.totalLabel}>{t.orderTotal}</span>
        <span>{formatCents(order.totalCents, locale, order.currency)}</span>
      </p>

      {servido ? <p className={styles.thanks}>{t.orderThanks}</p> : null}
    </section>
  );
}
