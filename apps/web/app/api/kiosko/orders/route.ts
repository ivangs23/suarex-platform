import {
  checkOrderRateLimit,
  createPendingOrder,
  findDeviceByTotemToken,
  getTenantSettings,
  OrderCartError,
} from "@suarex/db";
import { NextResponse } from "next/server";

// Alta de pedido del canal KIOSKO (totem). Hermana de `/api/orders` (canal QR), pero:
//  - La autoridad NO es la cookie de mesa, sino el `totem_token` del dispositivo (el totem lo
//    lleva en la URL que cargó). El pedido va `channel:'kiosko'`, sin `table_id`.
//  - NO se crea PaymentIntent de Stripe: el cobro lo hace el agente-desktop por Paytef, y él
//    marca el pedido pagado (`mark_kiosko_order_paid`). Aquí solo se deja el pedido `pending`.
const GENERIC_ERROR = "No se pudo procesar el pedido";

/** Etiqueta de mesa "en mesa": el cliente teclea 1–100. `null`/ausente = para llevar. */
function parseTableLabel(raw: unknown): string | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") return "invalid";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) return "invalid";
  return String(n);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    token?: string;
    tableLabel?: string | null;
    lines?: { productId: string; quantity: number; extraIds: string[]; notes: string | null }[];
  };

  if (!body.token || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }
  const tableLabel = parseTableLabel(body.tableLabel);
  if (tableLabel === "invalid") {
    return NextResponse.json({ error: "Número de mesa inválido (1–100)" }, { status: 400 });
  }

  let entry: Awaited<ReturnType<typeof findDeviceByTotemToken>>;
  try {
    entry = await findDeviceByTotemToken(body.token);
  } catch (error) {
    console.error("[kiosko] Error resolviendo el totem por token:", error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
  if (!entry) {
    return NextResponse.json({ error: "Totem no encontrado" }, { status: 404 });
  }

  // Rate-limit por DISPOSITIVO (el eje del abuso es el totem, no una mesa). Falla cerrado.
  let permitido: boolean;
  try {
    permitido = await checkOrderRateLimit(entry.deviceId);
  } catch (error) {
    console.error(`[kiosko] Rate-limit no disponible (device ${entry.deviceId}):`, error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
  if (!permitido) {
    return NextResponse.json(
      { error: "Demasiados pedidos en poco tiempo. Espera un momento e inténtalo de nuevo." },
      { status: 429 },
    );
  }

  let settings: Awaited<ReturnType<typeof getTenantSettings>>;
  try {
    settings = await getTenantSettings(entry.tenantId);
  } catch (error) {
    console.error(`[kiosko] Error leyendo ajustes del tenant ${entry.tenantId}:`, error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
  const taxRate = Number((settings?.fiscal as { taxRate?: number } | undefined)?.taxRate ?? 0.1);

  try {
    const order = await createPendingOrder({
      tenantId: entry.tenantId,
      venueId: entry.venueId,
      tableId: null,
      tableLabel,
      channel: "kiosko",
      lines: body.lines,
      taxRate,
    });
    // Sin Stripe: el pedido queda `pending`. El totem cobra por Paytef (window.totem.pay) y el
    // agente lo marca pagado. Un pedido que nadie paga lo barre `expire_pending_orders`.
    return NextResponse.json({
      orderId: order.orderId,
      publicToken: order.publicToken,
      totalCents: order.totalCents,
      currency: order.currency,
    });
  } catch (error) {
    if (error instanceof OrderCartError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error(
      `[kiosko] Error creando pedido pendiente (device ${entry.deviceId}, tenant ${entry.tenantId}):`,
      error,
    );
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
