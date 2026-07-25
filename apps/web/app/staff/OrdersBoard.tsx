"use client";

import type { StaffOrder } from "@suarex/db";
import { createBrowserClient, subscribeToOrders } from "@suarex/realtime";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { markStationDone, reprintOrderAction } from "./actions";
import styles from "./staff.module.css";

// Construido una sola vez por montaje del módulo, igual que en `staff/login/page.tsx`:
// NEXT_PUBLIC_* se inlinea en build time y no expone ninguna clave de servicio.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Station = "cocina" | "barra";

/**
 * El tablero NO vuelve a filtrar por tenant aquí: `orders` ya llega acotado al tenant de
 * la sesión desde `app/staff/page.tsx` (vía `listActiveOrders(session.tenantId)`), y este
 * componente se limita a agrupar por estación (cocina/barra) y a pintar lo que recibe.
 * Un filtrado adicional por tenant EN ESTE componente sería precisamente el patrón que
 * ya ha producido tests de aislamiento vacíos en este proyecto dos veces: si algún día
 * `listActiveOrders` tuviera una fuga, un filtro aquí la enmascararía y el pedido ajeno
 * simplemente no tendría dónde renderizarse, sin que ningún test lo notara.
 */
export function OrdersBoard({ tenantId, orders }: { tenantId: string; orders: StaffOrder[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Confirmación de una reimpresión. Separada de `error` porque no lo es: el ticket va a salir. */
  const [aviso, setAviso] = useState<string | null>(null);

  // Se suscribe con el MISMO cliente autenticado que usó el login (`createBrowserClient`
  // cachea un singleton, ver `packages/realtime/src/browser-client.ts`): la suscripción
  // viaja con la sesión del personal, así que RLS acota los eventos a este tenant -- un
  // cliente sin autenticar no vería nada y este tablero parecería, en silencio, "sin
  // pedidos" para siempre.
  useEffect(() => {
    const client = createBrowserClient(supabaseUrl, supabaseAnonKey);
    const unsubscribe = subscribeToOrders(client, tenantId, () => {
      router.refresh();
    });
    return unsubscribe;
  }, [tenantId, router]);

  // `na` significa "esta estación no tiene nada que hacer con este pedido" (calculado en
  // la creación, ver `createPendingOrder`): un pedido solo de bebidas no debe aparecer
  // como una tarjeta vacía en la columna de cocina a la espera de una acción imposible.
  const cocina = orders.filter((order) => order.kitchenStatus !== "na");
  const barra = orders.filter((order) => order.barStatus !== "na");

  // No se descarta la promesa con `void`: un fallo de la Server Action (sesión caducada,
  // orden ya no existe...) debe verse en pantalla, no desaparecer en silencio dejando al
  // personal creyendo que la comanda sigue pendiente cuando en realidad su clic no hizo
  // nada.
  function handleDone(orderId: string, station: Station) {
    setError(null);
    startTransition(() => {
      markStationDone(orderId, station).catch(() => {
        setError("No se pudo marcar la comanda. Inténtalo de nuevo.");
      });
    });
  }

  /* Reimprimir: devuelve el pedido a la cola del agente. Lo pide alguien que está mirando una
     impresora que no ha sacado nada -- se atascó, se quedó sin papel, estaba apagada -- así que
     un "no ha pasado nada" mudo es lo peor que puede hacer esta pantalla. Se dice tanto cuando
     sale bien (el ticket tarda unos segundos en salir y sin aviso alguien pulsa cinco veces)
     como cuando el pedido no era reimprimible. */
  function handleReprint(orderId: string) {
    setError(null);
    setAviso(null);
    startTransition(() => {
      reprintOrderAction(orderId)
        .then((hecho) => {
          setAviso(
            hecho
              ? "Reimprimiendo: el ticket saldrá en unos segundos."
              : "Ese pedido no se puede reimprimir.",
          );
        })
        .catch(() => {
          setError("No se pudo reimprimir. Inténtalo de nuevo.");
        });
    });
  }

  return (
    <>
      {error ? (
        <p className={styles.alert} role="alert">
          {error}
        </p>
      ) : null}
      {aviso ? (
        <p className={styles.notice} role="status" data-testid="staff-reprint-notice">
          {aviso}
        </p>
      ) : null}
      <div className={styles.board}>
        <section className={styles.column} aria-label="Cocina">
          <h2 className={styles.columnTitle}>Cocina</h2>
          {cocina.length === 0 ? <p className={styles.empty}>Sin comandas pendientes</p> : null}
          <div className={styles.cards}>
            {cocina.map((order) => (
              <OrderCard
                key={`cocina-${order.id}`}
                order={order}
                station="cocina"
                onDone={handleDone}
                onReprint={handleReprint}
                disabled={isPending}
              />
            ))}
          </div>
        </section>

        <section className={styles.column} aria-label="Barra">
          <h2 className={styles.columnTitle}>Barra</h2>
          {barra.length === 0 ? <p className={styles.empty}>Sin comandas pendientes</p> : null}
          <div className={styles.cards}>
            {barra.map((order) => (
              <OrderCard
                key={`barra-${order.id}`}
                order={order}
                station="barra"
                onDone={handleDone}
                onReprint={handleReprint}
                disabled={isPending}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function OrderCard({
  order,
  station,
  onDone,
  onReprint,
  disabled,
}: {
  order: StaffOrder;
  station: Station;
  onDone: (orderId: string, station: Station) => void;
  onReprint: (orderId: string) => void;
  disabled: boolean;
}) {
  const stationStatus = station === "cocina" ? order.kitchenStatus : order.barStatus;
  const items = order.items.filter((item) => item.destination === station);
  const done = stationStatus === "done";

  return (
    <article
      className={`${styles.card} ${done ? styles.done : ""}`}
      data-testid="order-card"
      data-order-id={order.id}
    >
      <h3 className={styles.cardHead}>
        <span>#{order.orderNumber}</span>
        {order.tableLabel ? <span className={styles.mesa}>Mesa {order.tableLabel}</span> : null}
      </h3>
      <ul className={styles.items}>
        {items.map((item) => (
          <li className={styles.item} key={`${item.name}-${item.quantity}-${item.notes ?? ""}`}>
            <span className={styles.qty}>{item.quantity}×</span>
            <span>
              {item.name}
              {item.notes ? <span className={styles.note}>{item.notes}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <div className={styles.cardActions}>
        {/* Secundario y sin confirmación: reimprimir no destruye nada -- como mucho salen dos
            tickets iguales, que es MUCHO menos malo que no salir ninguno, y quien lo pulsa
            está delante de la impresora comprobándolo. */}
        <button
          type="button"
          className={styles.reprintBtn}
          data-testid="order-reprint"
          onClick={() => onReprint(order.id)}
          disabled={disabled}
        >
          Reimprimir
        </button>
        <button
          type="button"
          className={styles.doneBtn}
          onClick={() => onDone(order.id, station)}
          disabled={disabled || done}
        >
          {done ? "Hecho" : "Marcar hecho"}
        </button>
      </div>
    </article>
  );
}
