import {
  centsToEuros,
  computeTotals,
  eurosToCents,
  lineTotal,
  type PricedLine,
} from "@suarex/domain";
import { nextOrderNumberRpc, ordersTableForPaymentResolution, tenantScoped } from "./client.js";
import type { CartLineInput, OrderStatus } from "./types.js";

type ProductRow = {
  id: string;
  name_i18n: Record<string, string>;
  price: string | number;
  is_available: boolean;
  categories: { destination: string } | null;
};

export async function createPendingOrder(input: {
  tenantId: string;
  venueId: string;
  tableId: string;
  lines: CartLineInput[];
  taxRate: number;
}): Promise<{ orderId: string; publicToken: string; totalCents: number; currency: string }> {
  if (input.lines.length === 0) throw new Error("El pedido no tiene líneas");
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Cantidad inválida: ${line.quantity}`);
    }
  }

  const productIds = [...new Set(input.lines.map((l) => l.productId))];

  // El filtro por tenant lo aplica tenantScoped: un producto de otro tenant
  // sencillamente no aparece, y la comprobación de abajo lo convierte en error.
  const { data: products, error } = await tenantScoped("products", input.tenantId)
    .select("id, name_i18n, price, is_available, categories(destination)")
    .in("id", productIds);
  if (error) throw error;

  const byId = new Map((products as unknown as ProductRow[]).map((p) => [p.id, p]));

  const priced: PricedLine[] = [];
  const rows: {
    product_id: string;
    name_snapshot: Record<string, string>;
    unit_price: number;
    quantity: number;
    line_total: number;
    destination: string;
    notes: string | null;
  }[] = [];

  for (const line of input.lines) {
    const product = byId.get(line.productId);
    if (!product?.is_available) {
      throw new Error(`Producto no disponible: ${line.productId}`);
    }

    // Los precios SIEMPRE salen de la base de datos, nunca del carrito del cliente.
    const unitPrice = eurosToCents(Number(product.price));
    const pricedLine: PricedLine = { unitPrice, quantity: line.quantity, extras: [] };
    priced.push(pricedLine);

    rows.push({
      product_id: product.id,
      name_snapshot: product.name_i18n,
      unit_price: Number(product.price),
      quantity: line.quantity,
      // Misma función que usa computeTotals() para el total del pedido: una sola
      // definición de "cuánto cuesta una línea" en vez de reimplementarla aquí y
      // arriesgarse a que ambas diverjan en cuanto se conecten las extras.
      line_total: centsToEuros(lineTotal(pricedLine)),
      destination: product.categories?.destination ?? "cocina",
      notes: line.notes,
    });
  }

  const totals = computeTotals(priced, input.taxRate);

  const hasKitchen = rows.some((r) => r.destination === "cocina");
  const hasBar = rows.some((r) => r.destination === "barra");

  const { data: numberData, error: numberError } = await nextOrderNumberRpc(
    input.tenantId,
    input.venueId,
  );
  if (numberError) throw numberError;
  const orderNumber = numberData as number;

  const { data: order, error: orderError } = await tenantScoped("orders", input.tenantId)
    .insert({
      venue_id: input.venueId,
      table_id: input.tableId,
      order_number: orderNumber,
      channel: "qr-mesa",
      status: "pending",
      subtotal: centsToEuros(totals.subtotal),
      tax_amount: centsToEuros(totals.taxAmount),
      total: centsToEuros(totals.total),
      kitchen_status: hasKitchen ? "pending" : "na",
      bar_status: hasBar ? "pending" : "na",
    })
    .select("id, public_token, currency")
    .single();
  if (orderError) throw orderError;

  const { error: itemsError } = await tenantScoped("order_items", input.tenantId).insert(
    rows.map((r) => ({ ...r, order_id: order.id })),
  );
  if (itemsError) throw itemsError;

  return {
    orderId: order.id as string,
    publicToken: order.public_token as string,
    totalCents: totals.total,
    currency: order.currency as string,
  };
}

export async function attachPaymentIntent(
  tenantId: string,
  orderId: string,
  paymentIntentId: string,
): Promise<void> {
  const { error } = await tenantScoped("orders", tenantId)
    .update({ stripe_payment_intent_id: paymentIntentId })
    .eq("id", orderId);
  if (error) throw error;
}

/**
 * Idempotente por construcción: el `.eq("status", "pending")` hace que una segunda
 * llamada no encuentre filas que actualizar, así que `paid_at` conserva el instante
 * del primer cobro y el pedido no cambia. Devuelve si ya estaba pagado para que el
 * webhook pueda registrarlo sin tratarlo como error.
 */
export async function markOrderPaid(paymentIntentId: string): Promise<{ alreadyPaid: boolean }> {
  const { data, error } = await ordersTableForPaymentResolution()
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("stripe_payment_intent_id", paymentIntentId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;

  return { alreadyPaid: (data ?? []).length === 0 };
}

export async function getOrderByPublicToken(publicToken: string): Promise<OrderStatus | null> {
  const { data, error } = await ordersTableForPaymentResolution()
    .select("order_number, status, total, currency")
    .eq("public_token", publicToken)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    orderNumber: data.order_number as number,
    status: data.status as string,
    totalCents: eurosToCents(Number(data.total)),
    currency: data.currency as string,
  };
}
