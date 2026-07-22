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
export async function unprintedPaidOrdersForDevice(
  client: SupabaseClient,
): Promise<PrintableOrder[]> {
  const { data: printerRows, error: printersError } = await client
    .from("printers")
    .select("id, venue_id, destination")
    .eq("enabled", true);
  if (printersError) throw printersError;

  const { data: orderRows, error: ordersError } = await client
    .from("orders")
    .select(
      "id, order_number, created_at, printed_targets, venue_id, kitchen_status, bar_status, " +
        "tables(label), order_items(name_snapshot, quantity, destination, notes)",
    )
    .not("paid_at", "is", null)
    .is("printed_at", null)
    .order("created_at", { ascending: true });
  if (ordersError) throw ordersError;

  return selectUnprintedOrders(
    orderRows as unknown as PaidOrderRow[],
    printerRows as unknown as EnabledPrinterRow[],
  );
}
