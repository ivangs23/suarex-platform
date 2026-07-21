"use client";

import type { StaffOrder } from "@suarex/db";
import { createBrowserClient, subscribeToOrders } from "@suarex/realtime";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { markStationDone } from "./actions";

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

  return (
    <div>
      {error ? <p role="alert">{error}</p> : null}
      <section aria-label="Cocina">
        <h2>Cocina</h2>
        {cocina.length === 0 ? <p>Sin comandas pendientes</p> : null}
        {cocina.map((order) => (
          <OrderCard
            key={`cocina-${order.id}`}
            order={order}
            station="cocina"
            onDone={handleDone}
            disabled={isPending}
          />
        ))}
      </section>

      <section aria-label="Barra">
        <h2>Barra</h2>
        {barra.length === 0 ? <p>Sin comandas pendientes</p> : null}
        {barra.map((order) => (
          <OrderCard
            key={`barra-${order.id}`}
            order={order}
            station="barra"
            onDone={handleDone}
            disabled={isPending}
          />
        ))}
      </section>
    </div>
  );
}

function OrderCard({
  order,
  station,
  onDone,
  disabled,
}: {
  order: StaffOrder;
  station: Station;
  onDone: (orderId: string, station: Station) => void;
  disabled: boolean;
}) {
  const stationStatus = station === "cocina" ? order.kitchenStatus : order.barStatus;
  const items = order.items.filter((item) => item.destination === station);
  const done = stationStatus === "done";

  return (
    <article data-testid="order-card">
      <h3>
        Pedido #{order.orderNumber}
        {order.tableLabel ? ` — Mesa ${order.tableLabel}` : null}
      </h3>
      <ul>
        {items.map((item) => (
          <li key={`${item.name}-${item.quantity}-${item.notes ?? ""}`}>
            {item.quantity}× {item.name}
            {item.notes ? ` (${item.notes})` : null}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => onDone(order.id, station)} disabled={disabled || done}>
        {done ? "Hecho" : "Marcar hecho"}
      </button>
    </article>
  );
}
