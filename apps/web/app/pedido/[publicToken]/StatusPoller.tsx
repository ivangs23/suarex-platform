"use client";

import type { OrderStatus } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import { useEffect, useState } from "react";

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
}: {
  publicToken: string;
  initialOrder: OrderStatus;
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

  return (
    <>
      <p data-testid="order-status">{order.status}</p>
      <p>{formatCents(order.totalCents, "es-ES", order.currency)}</p>
    </>
  );
}
