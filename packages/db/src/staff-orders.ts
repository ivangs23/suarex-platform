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
 * la carta pública (`p.nameI18n.es ?? ...`): `es` primero porque es el
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
 * al UPDATE.
 *
 * UN SOLO UPDATE, con dos guardas de concurrencia/autorización, sin lectura previa:
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
 *
 * Fix round 2 (Finding 1): esta función YA NO decide por sí misma cuándo el pedido pasa
 * a `served` -- eso lo hace, dentro de esta MISMA sentencia, el trigger
 * `orders_auto_serve` (`20260721000008_orders_auto_serve.sql`). Antes había un segundo
 * UPDATE aquí ("si ambas estaciones quedaron resueltas, marca `served`"): si el proceso
 * moría entre los dos UPDATEs, el pedido quedaba con las estaciones resueltas pero
 * `status` varado para siempre (reintentar era un no-op garantizado, ver el commit de
 * este fix). Con el trigger, no existe ese "entre medias": o el UPDATE entero se aplica
 * -- estación Y, si corresponde, `served` -- o no se aplica nada.
 */
export async function markStationDone(
  tenantId: string,
  orderId: string,
  station: "cocina" | "barra",
): Promise<void> {
  const column = station === "cocina" ? "kitchen_status" : "bar_status";

  const { error } = await tenantScoped("orders", tenantId)
    .update({ [column]: "done" })
    .eq("id", orderId)
    .eq(column, "pending");
  if (error) throw error;
}

/**
 * VUELVE A IMPRIMIR un pedido: borra las marcas de impresión para que el agente lo saque otra vez
 * en su siguiente pasada.
 *
 * No imprime nada por sí misma, y ese es justo el punto. El agente ya sabe entregar un pedido en
 * la impresora que le toca, reintentar, marcar solo lo que entregó y no duplicar (at-least-once,
 * ver `reserve_printed`); reimprimir es SOLO devolver el pedido a ese camino. Una segunda vía de
 * impresión sería una segunda vía que mantener en sync y una segunda forma de duplicar tickets.
 *
 * Se limpian las DOS marcas a la vez porque significan cosas distintas y ambas excluyen el pedido
 * de la cola: `printed_targets` (qué impresora ya lo tiene) y `printed_at` (ya está cubierto del
 * todo). Vaciar solo una lo dejaría en un limbo del que no saldría nunca.
 *
 * El filtro `paid_at is not null` es el que hace que esto no pueda inventar trabajo: un pedido sin
 * pagar no entra en la cola del agente, así que "reimprimirlo" no tendría ningún efecto y decir
 * que sí lo tuvo sería mentir. Devuelve si de verdad ha tocado un pedido -- un id de otro tenant
 * (`tenantScoped`) o sin pagar no encuentra fila y devuelve `false`, para que quien llama pueda
 * decirlo en pantalla en vez de fingir éxito.
 */
export async function reprintOrder(tenantId: string, orderId: string): Promise<boolean> {
  const { data, error } = await tenantScoped("orders", tenantId)
    .update({ printed_targets: {}, printed_at: null })
    .eq("id", orderId)
    .not("paid_at", "is", null)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * Los pedidos COBRADOS de un día, con lo justo para cuadrar la caja.
 *
 * El corte va por `paid_at` y no por `created_at`: lo que se contabiliza es cuándo entró el
 * dinero, no cuándo alguien abrió la carta. Un pedido creado a las 23:55 y pagado a las 00:05
 * cuenta en el día siguiente, que es donde lo va a buscar quien cuadre la caja.
 *
 * `from`/`to` llegan ya resueltos como instantes por quien llama, porque el día de un negocio
 * depende de su zona horaria y este paquete no la conoce.
 */
export async function paidOrdersBetween(
  tenantId: string,
  from: string,
  to: string,
): Promise<
  { channel: string; totalCents: number; lines: { lineCents: number; taxRate: number }[] }[]
> {
  const { data, error } = await tenantScoped("orders", tenantId)
    .select("channel, total, order_items(line_total, tax_rate)")
    .not("paid_at", "is", null)
    .gte("paid_at", from)
    .lt("paid_at", to);
  if (error) throw error;

  type Fila = {
    channel: string | null;
    total: string | number;
    order_items: { line_total: string | number; tax_rate: string | number }[] | null;
  };

  return (data as unknown as Fila[]).map((row) => ({
    channel: row.channel ?? "qr-mesa",
    totalCents: Math.round(Number(row.total) * 100),
    lines: (row.order_items ?? []).map((item) => ({
      lineCents: Math.round(Number(item.line_total) * 100),
      taxRate: Number(item.tax_rate),
    })),
  }));
}
