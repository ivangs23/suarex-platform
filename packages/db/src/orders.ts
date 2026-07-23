import {
  centsToEuros,
  computeTotals,
  eurosToCents,
  lineTotal,
  type PricedLine,
} from "@suarex/domain";
import {
  expirePendingOrdersRpc,
  nextOrderNumberRpc,
  ordersTableForPaymentResolution,
  tenantScoped,
} from "./client.js";
import { getTenantSettings } from "./tenants.js";
import type { CartLineInput, OrderReceipt, OrderStatus, ReceiptLine } from "./types.js";

type ProductRow = {
  id: string;
  name_i18n: Record<string, string>;
  price: string | number;
  is_available: boolean;
  categories: { destination: string } | null;
};

type ExtraRow = {
  id: string;
  product_id: string;
  name_i18n: Record<string, string>;
  price: string | number;
};

/**
 * Fallos que describen algo sobre EL CARRITO del comensal (línea con cantidad
 * inválida, producto que ya no existe/está disponible para este tenant) y que por
 * tanto es seguro y útil devolver tal cual a un llamante anónimo: le dicen qué
 * línea debe quitar o corregir. Es la ÚNICA clase de error de esta función que el
 * route handler (`apps/web/app/api/orders/route.ts`) reenvía verbatim; cualquier
 * `Error` normal que salga de aquí (fallo de Postgres, RPC, restricción de
 * `assert_same_tenant`, taxRate de la config del tenant fuera de rango...) no es
 * culpa ni asunto del comensal y el route handler lo colapsa a un mensaje
 * genérico, registrando el original en el log del servidor.
 */
export class OrderCartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderCartError";
  }
}

export async function createPendingOrder(input: {
  tenantId: string;
  venueId: string;
  tableId: string;
  lines: CartLineInput[];
  taxRate: number;
}): Promise<{ orderId: string; publicToken: string; totalCents: number; currency: string }> {
  if (input.lines.length === 0) throw new OrderCartError("El pedido no tiene líneas");
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new OrderCartError(`Cantidad inválida: ${line.quantity}`);
    }
  }

  // `taxRate` acaba en subtotal/tax_amount de un recibo fiscal persistido, así
  // que se valida ANTES de tocar la base de datos, no solo en computeTotals.
  // Rango elegido deliberadamente para un tipo de IVA, no una lista cerrada de
  // valores españoles (el sistema es multi-tenant y puede servir otras
  // jurisdicciones):
  //   - `>= 0`: un tipo de IVA negativo no es un concepto fiscal real para un
  //     precio de carta; no existe jurisdicción con IVA negativo.
  //   - `< 1`: ninguna jurisdicción conocida aplica un IVA/IGV >= 100 % sobre
  //     bienes de hostelería (el tipo estándar más alto del mundo ronda el
  //     25-27 %); `< 1` deja margen amplio para cualquier país sin permitir
  //     valores absurdos. De propina, atrapa el error clásico de pasar el tipo
  //     como porcentaje entero (`21`) en vez de fracción (`0.21`): 21 nunca
  //     entra en este rango y el error señala el valor exacto recibido.
  if (!Number.isFinite(input.taxRate) || input.taxRate < 0 || input.taxRate >= 1) {
    throw new Error(`taxRate fuera de rango (se espera [0, 1)): ${input.taxRate}`);
  }

  const productIds = [...new Set(input.lines.map((l) => l.productId))];

  // El filtro por tenant lo aplica tenantScoped: un producto de otro tenant
  // sencillamente no aparece, y la comprobación de abajo lo convierte en error.
  const { data: products, error } = await tenantScoped("products", input.tenantId)
    .select("id, name_i18n, price, is_available, categories(destination)")
    .in("id", productIds);
  if (error) throw error;

  const byId = new Map((products as unknown as ProductRow[]).map((p) => [p.id, p]));

  // Igual que con los productos: el filtro por tenant lo aplica tenantScoped, así que un
  // extraId de otro tenant sencillamente no aparece en `extrasById` -- y por tanto cae en
  // la misma rama de "no disponible" que un id inventado, sin distinción observable.
  const allExtraIds = [...new Set(input.lines.flatMap((line) => line.extraIds))];
  const extrasById = new Map<string, ExtraRow>();
  if (allExtraIds.length > 0) {
    const { data: extraRows, error: extrasError } = await tenantScoped(
      "product_extras",
      input.tenantId,
    )
      .select("id, product_id, name_i18n, price")
      .in("id", allExtraIds);
    if (extrasError) throw extrasError;
    for (const extraRow of extraRows as unknown as ExtraRow[]) {
      extrasById.set(extraRow.id, extraRow);
    }
  }

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
  // Paralelo a `rows` (mismo índice = misma línea): las extras congeladas de esa línea,
  // pendientes todavía del `order_item_id` que solo existe tras insertar `order_items`.
  const extrasForRows: {
    extra_id: string;
    name_snapshot: Record<string, string>;
    price: number;
  }[][] = [];

  for (const line of input.lines) {
    const product = byId.get(line.productId);
    if (!product?.is_available) {
      throw new OrderCartError(`Producto no disponible: ${line.productId}`);
    }

    // Los precios SIEMPRE salen de la base de datos, nunca del carrito del cliente.
    const unitPrice = eurosToCents(Number(product.price));

    // Deduplicado: un id de extra repetido en la misma línea (accidental o forzado por
    // el cliente) representa la misma elección real una sola vez, así que se cobra una
    // sola vez -- no tantas veces como aparezca en el array.
    const uniqueExtraIds = [...new Set(line.extraIds)];
    const lineExtraRows: {
      extra_id: string;
      name_snapshot: Record<string, string>;
      price: number;
    }[] = [];
    const extrasCents: number[] = [];
    for (const extraId of uniqueExtraIds) {
      const extra = extrasById.get(extraId);
      // `extra.product_id !== line.productId` cierra la vía de un extra real, del MISMO
      // tenant, pero que pertenece a otro producto: sin esta comprobación, el precio
      // (correcto en la base de datos) se aplicaría a un producto para el que esa extra
      // nunca se ofreció.
      if (!extra || extra.product_id !== line.productId) {
        throw new OrderCartError(`Extra no disponible: ${extraId}`);
      }
      const extraPriceCents = eurosToCents(Number(extra.price));
      extrasCents.push(extraPriceCents);
      lineExtraRows.push({
        extra_id: extra.id,
        name_snapshot: extra.name_i18n,
        price: Number(extra.price),
      });
    }
    extrasForRows.push(lineExtraRows);

    const pricedLine: PricedLine = { unitPrice, quantity: line.quantity, extras: extrasCents };
    priced.push(pricedLine);

    rows.push({
      product_id: product.id,
      name_snapshot: product.name_i18n,
      unit_price: Number(product.price),
      quantity: line.quantity,
      // Misma función que usa computeTotals() para el total del pedido: una sola
      // definición de "cuánto cuesta una línea" en vez de reimplementarla aquí y
      // arriesgarse a que ambas diverjan.
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

  // Se inserta una línea a la vez (en vez de un único insert masivo con `.select("id")`)
  // para poder correlacionar CADA `order_item_id` recién creado con SUS extras, sin
  // depender de que Postgres devuelva las filas de un INSERT múltiple en el mismo orden
  // en que se enviaron -- ese orden no es una garantía del estándar SQL, y este
  // emparejamiento es dinero: un id equivocado ataría las extras de una línea a otra.
  const insertedItemIds: string[] = [];
  for (const row of rows) {
    const { data: itemRow, error: itemError } = await tenantScoped("order_items", input.tenantId)
      .insert({ ...row, order_id: order.id })
      .select("id")
      .single();
    if (itemError) throw itemError;
    insertedItemIds.push(itemRow.id as string);
  }

  const extraInsertRows = insertedItemIds.flatMap((orderItemId, index) =>
    (extrasForRows[index] ?? []).map((extraRow) => ({ ...extraRow, order_item_id: orderItemId })),
  );
  if (extraInsertRows.length > 0) {
    const { error: extrasInsertError } = await tenantScoped(
      "order_item_extras",
      input.tenantId,
    ).insert(extraInsertRows);
    if (extrasInsertError) throw extrasInsertError;
  }

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
 * Se llama cuando un pedido `pending` ya se creó pero el intento de pago de Stripe
 * (o su asociación al pedido) falla justo después, en `apps/web/app/api/orders/route.ts`.
 * Sin esto, el pedido queda huérfano en `pending` para siempre: no solo es basura en
 * la base de datos, sino que `kitchen_status`/`bar_status` pueden quedar en `pending`
 * también, así que cocina/barra podrían llegar a ver y preparar un pedido que jamás
 * tuvo -- ni podrá tener -- un cobro válido asociado.
 *
 * Se marca `cancelled` (valor válido del CHECK de `orders.status`) en vez de borrarlo:
 * el pedido y sus líneas quedan trazables para depuración/auditoría, y `cancelled` es
 * distinguible de un `pending` legítimo que sigue esperando el pago del comensal.
 *
 * El `.eq("status", "pending")` es la misma guarda de concurrencia que usa
 * `markOrderPaid`: si por lo que sea el pedido ya cambió de estado entre medias, esta
 * llamada no pisa nada.
 */
export async function cancelOrphanedPendingOrder(tenantId: string, orderId: string): Promise<void> {
  const { error } = await tenantScoped("orders", tenantId)
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .eq("status", "pending");
  if (error) throw error;
}

/**
 * Tres resultados, no dos, porque conflar los tres tiraría una señal que vale
 * la pena conservar:
 *   - "marked": el pedido existía en `pending` y se acaba de marcar pagado.
 *   - "already-paid": el pedido existe pero ya no estaba `pending` (webhook
 *     duplicado -- normal e inofensivo).
 *   - "order-not-found": ningún pedido tiene ese `stripe_payment_intent_id`.
 *     Esto NO es inofensivo: implica un cobro sin pedido asociado en este
 *     sistema, un webhook apuntando al entorno equivocado, o alguien
 *     sondeando el endpoint.
 */
export type MarkPaidOutcome = "marked" | "already-paid" | "order-not-found";

/**
 * Idempotente por construcción: el UPDATE lleva `.eq("status", "pending")`, así
 * que una segunda llamada no encuentra filas que actualizar (0 filas afectadas)
 * y `paid_at` conserva el instante del primer cobro. El resultado del UPDATE
 * (filas realmente afectadas) es lo que decide "marked", no una lectura previa
 * del estado -- así, ante dos webhooks concurrentes para el mismo
 * paymentIntentId, como mucho uno de los dos ve "marked" y el otro cae al
 * SELECT de abajo y ve "already-paid", nunca los dos "marked".
 *
 * Solo si el UPDATE no afectó ninguna fila hace falta un SELECT adicional para
 * distinguir "already-paid" (la fila existe, pero no estaba pending) de
 * "order-not-found" (no existe ninguna fila con ese payment intent) -- un
 * único UPDATE no puede por sí mismo distinguir esos dos casos.
 */
export async function markOrderPaid(paymentIntentId: string): Promise<MarkPaidOutcome> {
  const { data: updated, error: updateError } = await ordersTableForPaymentResolution()
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("stripe_payment_intent_id", paymentIntentId)
    .eq("status", "pending")
    .select("id");
  if (updateError) throw updateError;
  if ((updated ?? []).length > 0) return "marked";

  const { data: existing, error: selectError } = await ordersTableForPaymentResolution()
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (selectError) throw selectError;

  return existing ? "already-paid" : "order-not-found";
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

/**
 * Locale del cliente dueño de un pedido, para formatear su total en la pantalla de estado.
 *
 * Va aparte de `getOrderByPublicToken` a propósito: ese devuelve la forma EXACTA que sirve el
 * endpoint público del comensal (`/api/pedido/[token]`, con un test que fija sus claves), y
 * meterle el locale cambiaría ese contrato. El locale no cambia entre sondeos, así que se lee
 * una vez en el render del servidor y se pasa como prop. Sin cliente resuelto, "es".
 */
export async function getOrderLocale(publicToken: string): Promise<string> {
  const { data, error } = await ordersTableForPaymentResolution()
    .select("tenant_id")
    .eq("public_token", publicToken)
    .maybeSingle();
  if (error) throw error;
  if (!data) return "es";

  const settings = await getTenantSettings(data.tenant_id as string);
  return settings?.locale ?? "es";
}

/**
 * Cancela los pedidos que llevan `pending` más de `timeoutMinutes` y devuelve cuántos.
 *
 * Un pedido queda `pending` cuando el comensal crea el pedido pero no completa el pago (cierra
 * la pestaña, se le acaba la batería). Sin barrerlos, se acumulan para siempre: ensucian el
 * tablero del personal y las métricas. La migración `20260721000009` intenta programar esto
 * con pg_cron, pero el Supabase autoalojado del despliegue no siempre trae pg_cron en
 * `shared_preload_libraries`; ahí esta función se llama desde el endpoint de cron
 * (`/api/internal/expire-orders`), disparado por el cron del sistema. Es idempotente: dos
 * ejecuciones seguidas no cancelan nada nuevo.
 *
 * `security definer` en la función SQL; aquí se llega por `service_role`. NO acota por tenant
 * a propósito -- es mantenimiento global de la plataforma, no una operación de un cliente.
 */
export async function expirePendingOrders(timeoutMinutes = 30): Promise<number> {
  const { data, error } = await expirePendingOrdersRpc(timeoutMinutes);
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

/** Resuelve un `name_snapshot` (jsonb por idioma) al idioma dado, con es de respaldo. */
function nombreSnapshot(snapshot: Record<string, string>, lang: string): string {
  return snapshot[lang] ?? snapshot.es ?? Object.values(snapshot)[0] ?? "";
}

/**
 * Recibo del comensal: el desglose de SU pedido por su `publicToken` -- el mismo token
 * anónimo con el que ve el estado, sin necesidad de sesión. Todo sale de los SNAPSHOTS
 * congelados en la compra (nombres y precios), no del catálogo de hoy: un recibo tiene que
 * reflejar lo que se pidió y se pagó, aunque después cambien los precios o desaparezca un
 * plato. Devuelve `null` si el token no resuelve.
 */
export async function getOrderReceipt(
  publicToken: string,
  lang = "es",
): Promise<OrderReceipt | null> {
  const { data, error } = await ordersTableForPaymentResolution()
    .select(
      "order_number, created_at, total, currency, tables(label), " +
        "order_items(id, name_snapshot, quantity, line_total, notes, " +
        "order_item_extras(name_snapshot, price))",
    )
    .eq("public_token", publicToken)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // El embed de PostgREST no lo tipa bien el SDK (lo colapsa a un error genérico), así que se
  // castea la fila entera a la forma que la propia `select` garantiza.
  const row = data as unknown as {
    order_number: number;
    created_at: string;
    total: number;
    currency: string;
    tables: { label?: string } | null;
    order_items: {
      id: string;
      name_snapshot: Record<string, string>;
      quantity: number;
      line_total: number;
      notes: string | null;
      order_item_extras: { name_snapshot: Record<string, string>; price: number }[];
    }[];
  };

  const lines: ReceiptLine[] = (row.order_items ?? []).map((item) => ({
    id: item.id,
    name: nombreSnapshot(item.name_snapshot, lang),
    quantity: item.quantity,
    lineTotalCents: eurosToCents(Number(item.line_total)),
    notes: item.notes,
    extras: (item.order_item_extras ?? []).map((extra) => ({
      name: nombreSnapshot(extra.name_snapshot, lang),
      priceCents: eurosToCents(Number(extra.price)),
    })),
  }));

  return {
    orderNumber: row.order_number,
    createdAt: row.created_at,
    tableLabel: row.tables?.label ?? null,
    totalCents: eurosToCents(Number(row.total)),
    currency: row.currency,
    lines,
  };
}
