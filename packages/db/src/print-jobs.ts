import { eurosToCents } from "@suarex/domain";
import { reservePrintedRpc, tenantScoped } from "./client.js";

export type PrintableItem = {
  name: string;
  quantity: number;
  destination: "cocina" | "barra";
  notes: string | null;
  /** Nombres de las extras de la línea. La comanda hoy no las pinta; el RECIBO sí. */
  extras: string[];
  /** Total de la línea en céntimos (unidad × cantidad, extras incluidas). Solo el recibo lo usa. */
  lineCents: number;
};

export type PrintableOrder = {
  id: string;
  orderNumber: number;
  tableLabel: string | null;
  createdAt: string;
  /** Canal del pedido. En `kiosko` el recibo del cliente es una impresora de destino más. */
  channel: "qr-mesa" | "kiosko";
  /** Token público del pedido: de él sale el código de recogida que el comensal vio en pantalla. */
  publicToken: string;
  /** Importes del pedido, en céntimos, para el recibo del cliente. */
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  printedTargets: Record<string, string>;
  /**
   * Local (venue) al que pertenece el pedido. Añadido en la revisión final whole-branch de
   * C2a (Finding 1: ceguera de venue en el bucle de entrega): sin esto, `runAgentTick`
   * (`packages/agent/src/run-agent.ts`) no tenía forma de comprobar que solo una impresora
   * DEL MISMO local del pedido lo imprime, y en un tenant multi-local una impresora de
   * OTRO local con el mismo `destination` (p. ej. "cocina") lo imprimía también --
   * silenciosamente, en el local equivocado. El camino de lectura ya filtraba por venue
   * (`targetPrinterIds` abajo), pero ese filtrado decide SOLO si el pedido está cubierto,
   * no expone el `venue_id` al llamante para que el bucle de entrega pueda repetir la
   * misma comprobación impresora a impresora.
   */
  venueId: string;
  items: PrintableItem[];
};

type StationStatus = "pending" | "done" | "na";

export type PaidOrderRow = {
  id: string;
  order_number: number;
  created_at: string;
  printed_targets: Record<string, string>;
  venue_id: string;
  kitchen_status: StationStatus;
  bar_status: StationStatus;
  channel: "qr-mesa" | "kiosko";
  public_token: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  currency: string;
  tables: { label: string } | null;
  /** Mesa del canal KIOSKO (totem): ahí no hay `table_id` que resolver por `tables`, la mesa se
   *  teclea y se guarda como texto en el propio pedido. `null` para llevar. */
  table_label: string | null;
  order_items: {
    name_snapshot: Record<string, string>;
    quantity: number;
    destination: "cocina" | "barra";
    notes: string | null;
    line_total: number;
    order_item_extras: { name_snapshot: Record<string, string> }[];
  }[];
};

export type EnabledPrinterRow = {
  id: string;
  venue_id: string;
  destination: "cocina" | "barra" | "all" | "recibo";
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
 * `printed_at` -- ambas deben mantenerse en sync (ver el test de acuerdo SQL/TS en
 * `tests/integration/print-jobs.test.ts`).
 *
 * TRADE-OFF DELIBERADO (revisado y confirmado -- NO cambiar este comportamiento): una
 * lista vacía cubre dos situaciones muy distintas que esta función no puede distinguir
 * con la información que recibe:
 *   1. El pedido de verdad no necesita esa estación (`kitchen_status`/`bar_status` en
 *      `'na'`) -- caso normal, nada que imprimir.
 *   2. El local tiene una estación configurada (`kitchen_status`/`bar_status` distinto
 *      de `'na'`) pero CERO impresoras habilitadas para ese `destination` -- típicamente
 *      un local mal configurado (p. ej. nadie asignó impresora de barra).
 * En el caso (2), tratar la estación como "cubierta" evita que el pedido quede
 * pendiente para siempre (la alternativa -- nunca trivialmente cubierto -- deja al
 * pedido atascado sin ninguna forma de completarse, ya que jamás habrá una impresora
 * real que lo reclame). El coste es que el ticket de esa estación se pierde en
 * silencio: el pedido aparece como completamente impreso aunque cocina o barra nunca
 * vieron nada. Hoy nada registra que esto ocurrió.
 *
 * DEFERRED (no implementado aquí, a propósito): una fase posterior debería exponer en
 * la UI de admin qué pedidos se completaron con una estación sin impresora asignada,
 * para que el dueño del local pueda corregir la configuración. No existe ningún sink de
 * logging/telemetría en este paquete (`packages/db`) sobre el que enganchar un aviso
 * sin inventar infraestructura nueva -- ver `reservePrinted` más abajo para el mismo
 * razonamiento aplicado al lado SQL. Aceptado para C1 porque el agente de impresión
 * (consumidor de este módulo) no tiene UI propia donde mostrar este aviso.
 */
function targetPrinterIds(
  order: Pick<PaidOrderRow, "venue_id" | "kitchen_status" | "bar_status" | "channel">,
  printers: EnabledPrinterRow[],
): string[] {
  const needed = new Set<"cocina" | "barra" | "recibo">();
  if (order.kitchen_status !== "na") needed.add("cocina");
  if (order.bar_status !== "na") needed.add("barra");
  // El recibo del cliente es obligatorio en kiosko (el totem lo saca), no en QR. Debe casar con
  // la MISMA regla del SQL `reserve_printed` (20260724000005_recibo_printer.sql), que decide
  // cuándo se fija `printed_at` -- el test de acuerdo lo comprueba.
  if (order.channel === "kiosko") needed.add("recibo");

  return printers
    .filter((p) => p.venue_id === order.venue_id)
    .filter((p) => p.destination === "all" || needed.has(p.destination))
    .map((p) => p.id);
}

/**
 * Núcleo PURO (sin I/O) de `unprintedPaidOrders`: dado el conjunto crudo de filas de
 * `orders` (pagadas y sin `printed_at`) y de `printers` habilitadas, decide qué pedidos
 * siguen pendientes de imprimir y los mapea a `PrintableOrder`. Extraído para que la ruta
 * del dispositivo (`@suarex/agent`, que lee con el JWT del device en vez del service role)
 * reutilice EXACTAMENTE esta lógica sin una tercera copia -- ver el razonamiento en
 * `docs/superpowers/specs/2026-07-22-agente-impresion-c2a-design.md`. El aislamiento por
 * tenant NO vive aquí: lo aplica quien hace los `select` (tenantScoped en la ruta
 * service-role, la RLS en la del dispositivo), así que esta función solo ve filas del
 * tenant correcto y no necesita conocer el `tenant_id`.
 */
export function selectUnprintedOrders(
  orderRows: PaidOrderRow[],
  printerRows: EnabledPrinterRow[],
): PrintableOrder[] {
  return orderRows
    .filter((row) => {
      const targets = targetPrinterIds(row, printerRows);
      if (targets.length === 0) return false; // nada que imprimir: no queda pendiente
      const covered = row.printed_targets ?? {};
      return !targets.every((id) => Object.hasOwn(covered, id));
    })
    .map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      // QR: la mesa la resuelve `tables(label)` por `table_id`. Kiosko: no hay `table_id`, la
      // mesa es el texto tecleado en el totem (`table_label`). Uno u otro; nunca los dos.
      tableLabel: row.tables?.label ?? row.table_label ?? null,
      createdAt: row.created_at,
      channel: row.channel,
      publicToken: row.public_token,
      subtotalCents: eurosToCents(Number(row.subtotal)),
      taxCents: eurosToCents(Number(row.tax_amount)),
      totalCents: eurosToCents(Number(row.total)),
      currency: row.currency,
      printedTargets: row.printed_targets ?? {},
      venueId: row.venue_id,
      items: row.order_items.map((item) => ({
        name: resolveItemName(item.name_snapshot),
        quantity: item.quantity,
        destination: item.destination,
        notes: item.notes,
        extras: item.order_item_extras.map((extra) => resolveItemName(extra.name_snapshot)),
        lineCents: eurosToCents(Number(item.line_total)),
      })),
    }));
}

/**
 * Pedidos pagados de `tenantId` cuyo `printed_targets` todavía NO cubre todas sus
 * impresoras de destino (ver `targetPrinterIds`). Un pedido totalmente cubierto (todas
 * sus impresoras de destino ya presentes en `printed_targets`, con lo que
 * `reservePrinted` ya habrá fijado `printed_at`) NO aparece -- es el mecanismo de
 * recuperación de la fase C: cualquier proceso que llame a esto en bucle reintenta
 * exactamente lo que falta, ni más ni menos.
 *
 * Fix (revisión final whole-branch, seam entre fases): el predicado YA NO es
 * `status = 'paid'`. `paid` no es un estado estable -- el trigger `orders_auto_serve`
 * (`20260721000008_orders_auto_serve.sql`) puede saltar `paid -> served` dentro de la
 * MISMA sentencia que `markOrderPaid` ejecuta, si el personal ya había resuelto ambas
 * estaciones en el tablero ANTES de que el webhook de Stripe confirmara el cobro (el
 * tablero no espera al pago, ver `listActiveOrders`/`markStationDone` en
 * `staff-orders.ts`). El pedido nunca "descansa" en `paid`, así que un filtro
 * `status = 'paid'` no lo ve jamás: su ticket no se imprime nunca y nada lo registra.
 *
 * El predicado correcto es "pagado pero todavía no completamente impreso",
 * independiente de cuánto haya avanzado `status` después del pago:
 * `paid_at is not null and printed_at is null`. `paid_at` solo lo escribe `markOrderPaid`
 * (`packages/db/src/orders.ts`), UNA sola vez, cuando el pedido sale de `pending`; nada
 * más en el paquete lo toca. `printed_at` solo lo escribe `reserve_printed` (SQL, ver
 * `supabase/migrations/20260722000003_print_reservation.sql`) cuando TODAS las
 * impresoras de destino quedan cubiertas. Esto hace el filtro estable frente a
 * `preparing`/`served`: el pedido sigue apareciendo aquí mientras le falte imprimir,
 * pase por los estados que pase, y deja de aparecer en cuanto `reserve_printed` fija
 * `printed_at`, sin importar en qué `status` esté entonces.
 *
 * Un pedido `cancelled` NUNCA puede colarse aquí: los dos únicos caminos que escriben
 * `status = 'cancelled'` (`cancelOrphanedPendingOrder` en `orders.ts`, y la función SQL
 * `expire_pending_orders` en `20260721000009_expire_pending_orders.sql`) llevan
 * `where status = 'pending'` -- un pedido solo puede cancelarse ANTES de que
 * `markOrderPaid` llegue a escribir `paid_at` nunca. Por construcción, `cancelled`
 * implica `paid_at is null`, así que ya queda excluido por el propio predicado sin
 * necesitar (ni querer) una comprobación explícita de `status <> 'cancelled'` --
 * añadirla sería redundante y, peor, sugeriría (falsamente) que un pedido cancelado
 * SÍ podría tener `paid_at` puesto en algún camino de escritura de este sistema. El
 * segundo test de "seam" de abajo (`tests/integration/print-jobs.test.ts`) fija este
 * comportamiento con un pedido cancelado real, no solo con esta nota.
 *
 * El índice que sirve esta consulta es `orders_unprinted_v2_idx`
 * (`supabase/migrations/20260722000004_orders_unprinted_predicate_fix.sql`), parcial
 * sobre exactamente este mismo predicado -- ver esa migración para la justificación de
 * su forma.
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
        "channel, public_token, subtotal, tax_amount, total, currency, table_label, tables(label), " +
        "order_items(name_snapshot, quantity, destination, notes, line_total, " +
        "order_item_extras(name_snapshot))",
    )
    .not("paid_at", "is", null)
    .is("printed_at", null)
    .order("created_at", { ascending: true });
  if (ordersError) throw ordersError;

  const printers = printerRows as unknown as EnabledPrinterRow[];
  return selectUnprintedOrders(orderRows as unknown as PaidOrderRow[], printers);
}

/**
 * Registra que UNA impresora concreta imprimió UN pedido. Delegado ENTERO en la función
 * SQL `reserve_printed` (SECURITY DEFINER, filtra por `tenantId` dentro de la propia
 * función) -- ver `supabase/migrations/20260722000003_print_reservation.sql` para el
 * merge atómico de `printed_targets` y el razonamiento de concurrencia/idempotencia. Un
 * `orderId` de otro tenant, o inexistente, resulta en un no-op silencioso (la función
 * SQL no encuentra fila y retorna sin hacer nada) -- igual que `markStationDone`.
 *
 * El propio SQL fija `printed_at` bajo el mismo trade-off "estación sin impresora ==
 * trivialmente cubierta" descrito arriba en `targetPrinterIds` -- ver el comentario en
 * la sentencia `coalesce(bool_and(...), true)` de la migración para el punto de
 * decisión exacto y el deferred item (aviso a admin, no implementado todavía).
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
