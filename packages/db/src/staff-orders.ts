import { tenantScoped } from "./client.js";

export type StaffOrderItem = {
  name: string;
  quantity: number;
  destination: "cocina" | "barra";
  notes: string | null;
};

export type StationStatus = "pending" | "done" | "na";

export type StaffOrder = {
  id: string;
  orderNumber: number;
  tableLabel: string | null;
  status: string;
  kitchenStatus: StationStatus;
  barStatus: StationStatus;
  items: StaffOrderItem[];
};

type StaffOrderRow = {
  id: string;
  order_number: number;
  status: string;
  kitchen_status: StationStatus;
  bar_status: StationStatus;
  tables: { label: string } | null;
  order_items: {
    name_snapshot: Record<string, string>;
    quantity: number;
    destination: "cocina" | "barra";
    notes: string | null;
  }[];
};

/**
 * `name_snapshot` es el nombre del producto EN EL MOMENTO del pedido (copiado, no una FK
 * viva al catálogo -- ver `order_items` en `20260721000005_orders.sql`), guardado como
 * i18n igual que `products.name_i18n`. Mismo criterio de resolución que
 * `apps/web/app/m/[token]/page.tsx` (`p.nameI18n.es ?? ...`): `es` primero porque es el
 * único locale que el seed y el flujo actual garantizan, con un fallback al primer valor
 * presente en vez de una cadena vacía si algún día se siembra un tenant sin `es`.
 */
function resolveItemName(nameSnapshot: Record<string, string>): string {
  return nameSnapshot.es ?? Object.values(nameSnapshot)[0] ?? "";
}

/**
 * Pedidos que cocina/barra todavía deben atender: cualquiera que no esté `served` (ambas
 * estaciones ya resueltas, ver `markStationDone`) ni `cancelled`. Deliberadamente NO se
 * filtra por `status = 'paid'`: en este momento del sistema un pedido recién creado por
 * `createPendingOrder` queda en `pending` hasta que el webhook de Stripe lo marca `paid`
 * (ver `packages/db/src/orders.ts`), y cocina/barra deben ver la comanda en cuanto existe
 * -- el pago es un problema de caja, no de si hay que prepararla.
 *
 * El `tenantId` SIEMPRE viene de `getStaffSession()` en el caller (`app/staff/page.tsx`),
 * nunca de un parámetro que el navegador controle -- `tenantScoped` lo exige como
 * argumento obligatorio y es la única vía de este paquete hacia `orders`.
 */
export async function listActiveOrders(tenantId: string): Promise<StaffOrder[]> {
  const { data, error } = await tenantScoped("orders", tenantId)
    .select(
      "id, order_number, status, kitchen_status, bar_status, tables(label), " +
        "order_items(name_snapshot, quantity, destination, notes)",
    )
    .neq("status", "served")
    .neq("status", "cancelled")
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data as unknown as StaffOrderRow[]).map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    tableLabel: row.tables?.label ?? null,
    status: row.status,
    kitchenStatus: row.kitchen_status,
    barStatus: row.bar_status,
    items: row.order_items.map((item) => ({
      name: resolveItemName(item.name_snapshot),
      quantity: item.quantity,
      destination: item.destination,
      notes: item.notes,
    })),
  }));
}

/**
 * Marca UNA estación (cocina o barra) de UN pedido como `done`. `tenantId` debe venir de
 * `getStaffSession()` -- ver docstring de `apps/web/app/staff/actions.ts` -- nunca de un
 * argumento que el navegador pueda fijar: `tenantScoped` lo hace obligatorio y lo aplica
 * tanto al UPDATE como (implícitamente) a cualquier lectura posterior.
 *
 * Dos guardas de concurrencia/autorización en un único UPDATE, sin lectura previa:
 *   - `.eq("id", orderId)`: solo esta comanda.
 *   - `.eq(column, "pending")`: la estación debe estar `pending` para que el UPDATE
 *     alcance alguna fila. Esto hace la función IDEMPOTENTE por construcción -- marcar
 *     dos veces la misma estación, o marcar una estación `na` (un pedido solo de bebidas
 *     no tiene nada que hacer en cocina), no encuentra filas que actualizar y no hace
 *     nada, en vez de lanzar o reescribir un estado ya resuelto.
 *
 * El filtro base `tenant_id = tenantId` de `tenantScoped` ya excluye cualquier pedido de
 * otro tenant antes de que estos dos `.eq()` adicionales entren en juego: un `orderId`
 * ajeno (adivinado o robado) sencillamente no encuentra fila, exactamente igual que en
 * `tests/integration/tenant-filter-structural.test.ts` para `categories`.
 */
export async function markStationDone(
  tenantId: string,
  orderId: string,
  station: "cocina" | "barra",
): Promise<void> {
  const column = station === "cocina" ? "kitchen_status" : "bar_status";

  const { data: updated, error } = await tenantScoped("orders", tenantId)
    .update({ [column]: "done" })
    .eq("id", orderId)
    .eq(column, "pending")
    .select("kitchen_status, bar_status")
    .maybeSingle();
  if (error) throw error;
  // No se actualizó ninguna fila: la comanda no existe para este tenant, ya estaba
  // `done`, o esa estación es `na`. Ninguno de los tres casos es un error del llamante.
  if (!updated) return;

  const row = updated as { kitchen_status: StationStatus; bar_status: StationStatus };
  const bothStationsResolved = row.kitchen_status !== "pending" && row.bar_status !== "pending";
  if (!bothStationsResolved) return;

  // Ambas estaciones fuera de `pending` (cada una `done` o `na`): el pedido pasa a
  // `served`. `.neq("status", "cancelled")` evita resucitar un pedido que, por lo que
  // sea, se canceló entre medias (huérfano de Stripe, ver `cancelOrphanedPendingOrder`).
  const { error: servedError } = await tenantScoped("orders", tenantId)
    .update({ status: "served" })
    .eq("id", orderId)
    .neq("status", "cancelled");
  if (servedError) throw servedError;
}
