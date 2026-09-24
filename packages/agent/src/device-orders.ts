import {
  type EnabledPrinterRow,
  type PaidOrderRow,
  type PrintableOrder,
  selectUnprintedOrders,
} from "@suarex/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pedidos pagados-sin-imprimir del tenant del DISPOSITIVO, leídos con SU JWT. Hace los
 * mismos dos `select` que `unprintedPaidOrders` (`@suarex/db`) pero sobre el cliente
 * autenticado del device en vez del cliente service-role: la RLS del rol `device` ya
 * permite el SELECT abierto a todo el tenant en `orders`/`order_items`/`printers` (fencing
 * de D2), y lo acota a su propio tenant. La lógica de "qué falta por imprimir" NO se
 * duplica: se delega en `selectUnprintedOrders`, la misma función pura que usa la ruta
 * service-role.
 */
/**
 * Solo la query de pedidos pagados-sin-imprimir (sin combinar con impresoras). Se expone
 * aparte para que `runAgentTick` pueda pedir las impresoras UNA sola vez por tick y compartir
 * esa lista entre "qué falta imprimir" y "a qué impresora imprimir" (antes se consultaba
 * `printers` dos veces por tick, #13), en vez de encadenar aquí printers→orders.
 */
export async function paidUnprintedOrderRows(client: SupabaseClient): Promise<PaidOrderRow[]> {
  const { data, error } = await client
    .from("orders")
    .select(
      "id, order_number, created_at, printed_targets, venue_id, kitchen_status, bar_status, " +
        "channel, public_token, subtotal, tax_amount, total, currency, table_label, tables(label), " +
        "order_items(name_snapshot, quantity, destination, notes, line_total, " +
        "order_item_extras(name_snapshot))",
    )
    .not("paid_at", "is", null)
    .is("printed_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as unknown as PaidOrderRow[];
}

export async function unprintedPaidOrdersForDevice(
  client: SupabaseClient,
): Promise<PrintableOrder[]> {
  // Las dos lecturas en paralelo (antes eran secuenciales). Uso autónomo (tests): el tick de
  // producción usa la ruta deduplicada de `runAgentTick`, no esta.
  const [printerResult, orderRows] = await Promise.all([
    client.from("printers").select("id, venue_id, destination").eq("enabled", true),
    paidUnprintedOrderRows(client),
  ]);
  if (printerResult.error) throw printerResult.error;

  return selectUnprintedOrders(orderRows, printerResult.data as unknown as EnabledPrinterRow[]);
}
