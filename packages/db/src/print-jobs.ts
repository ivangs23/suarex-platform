import { reservePrintedRpc, tenantScoped } from "./client.js";

export type PrintableItem = {
  name: string;
  quantity: number;
  destination: "cocina" | "barra";
  notes: string | null;
};

export type PrintableOrder = {
  id: string;
  orderNumber: number;
  tableLabel: string | null;
  createdAt: string;
  printedTargets: Record<string, string>;
  items: PrintableItem[];
};

type StationStatus = "pending" | "done" | "na";

type PaidOrderRow = {
  id: string;
  order_number: number;
  created_at: string;
  printed_targets: Record<string, string>;
  venue_id: string;
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

type EnabledPrinterRow = {
  id: string;
  venue_id: string;
  destination: "cocina" | "barra" | "all";
};

/** Mismo criterio de resolución que `staff-orders.ts`: `es` primero, con fallback al
 * primer valor presente si algún día se siembra un tenant sin `es`. */
function resolveItemName(nameSnapshot: Record<string, string>): string {
  return nameSnapshot.es ?? Object.values(nameSnapshot)[0] ?? "";
}

/**
 * Impresoras de destino de UN pedido: las habilitadas del MISMO local (venue) cuyo
 * `destination` coincide con alguna estación que el pedido realmente usa
 * (`kitchen_status`/`bar_status` distinto de 'na' -- mismo criterio con el que
 * `createPendingOrder`, en `orders.ts`, decide esas columnas) o que están marcadas
 * 'all' (imprimen cualquier pedido, sin importar la estación).
 *
 * Si el resultado es una lista vacía (ninguna impresora habilitada aplica a este
 * pedido/local), se trata como trivialmente cubierto en el llamante: no hay nada que
 * imprimir, así que el pedido no debe quedar pendiente para siempre de una impresora
 * que no existe. La MISMA regla vive, por separado, en `reserve_printed()` (SQL, ver
 * `supabase/migrations/20260722000003_print_reservation.sql`) para decidir cuándo fijar
 * `printed_at` -- ambas deben mantenerse en sync.
 */
function targetPrinterIds(
  order: Pick<PaidOrderRow, "venue_id" | "kitchen_status" | "bar_status">,
  printers: EnabledPrinterRow[],
): string[] {
  const needed = new Set<"cocina" | "barra">();
  if (order.kitchen_status !== "na") needed.add("cocina");
  if (order.bar_status !== "na") needed.add("barra");

  return printers
    .filter((p) => p.venue_id === order.venue_id)
    .filter((p) => p.destination === "all" || needed.has(p.destination))
    .map((p) => p.id);
}

/**
 * Pedidos pagados de `tenantId` cuyo `printed_targets` todavía NO cubre todas sus
 * impresoras de destino (ver `targetPrinterIds`). Un pedido totalmente cubierto (todas
 * sus impresoras de destino ya presentes en `printed_targets`, con lo que
 * `reservePrinted` ya habrá fijado `printed_at`) NO aparece -- es el mecanismo de
 * recuperación de la fase C: cualquier proceso que llame a esto en bucle reintenta
 * exactamente lo que falta, ni más ni menos.
 *
 * El filtro por tenant lo aplica `tenantScoped` tanto para `orders` como para
 * `printers`: un pedido o una impresora de otro tenant sencillamente no aparecen en las
 * filas leídas aquí, así que no pueden colarse en el cálculo de qué está cubierto.
 */
export async function unprintedPaidOrders(tenantId: string): Promise<PrintableOrder[]> {
  const { data: printerRows, error: printersError } = await tenantScoped("printers", tenantId)
    .select("id, venue_id, destination")
    .eq("enabled", true);
  if (printersError) throw printersError;

  const { data: orderRows, error: ordersError } = await tenantScoped("orders", tenantId)
    .select(
      "id, order_number, created_at, printed_targets, venue_id, kitchen_status, bar_status, " +
        "tables(label), order_items(name_snapshot, quantity, destination, notes)",
    )
    .eq("status", "paid")
    .order("created_at", { ascending: true });
  if (ordersError) throw ordersError;

  const printers = printerRows as unknown as EnabledPrinterRow[];

  return (orderRows as unknown as PaidOrderRow[])
    .filter((row) => {
      const targets = targetPrinterIds(row, printers);
      if (targets.length === 0) return false; // nada que imprimir: no queda pendiente
      const covered = row.printed_targets ?? {};
      return !targets.every((id) => Object.hasOwn(covered, id));
    })
    .map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      tableLabel: row.tables?.label ?? null,
      createdAt: row.created_at,
      printedTargets: row.printed_targets ?? {},
      items: row.order_items.map((item) => ({
        name: resolveItemName(item.name_snapshot),
        quantity: item.quantity,
        destination: item.destination,
        notes: item.notes,
      })),
    }));
}

/**
 * Registra que UNA impresora concreta imprimió UN pedido. Delegado ENTERO en la función
 * SQL `reserve_printed` (SECURITY DEFINER, filtra por `tenantId` dentro de la propia
 * función) -- ver `supabase/migrations/20260722000003_print_reservation.sql` para el
 * merge atómico de `printed_targets` y el razonamiento de concurrencia/idempotencia. Un
 * `orderId` de otro tenant, o inexistente, resulta en un no-op silencioso (la función
 * SQL no encuentra fila y retorna sin hacer nada) -- igual que `markStationDone`.
 */
export async function reservePrinted(
  tenantId: string,
  orderId: string,
  printerId: string,
  at: string,
): Promise<void> {
  const { error } = await reservePrintedRpc(tenantId, orderId, printerId, at);
  if (error) throw error;
}
