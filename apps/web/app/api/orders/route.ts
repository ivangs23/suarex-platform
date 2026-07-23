import {
  attachPaymentIntent,
  cancelOrphanedPendingOrder,
  checkOrderRateLimit,
  createPendingOrder,
  findTableByToken,
  getTenantSettings,
  getTenantStripeAccount,
  OrderCartError,
} from "@suarex/db";
import { NextResponse } from "next/server";
import { readMesaToken } from "@/lib/mesa-cookie";
import { stripeClient } from "@/lib/stripe";

// Mensaje genérico para cualquier fallo que NO sea un `OrderCartError`: el
// llamante es un comensal anónimo que escaneó un QR, así que nunca debe recibir
// detalle interno (mensajes de Postgres, nombres de restricciones, ids). El error
// real siempre se registra con console.error junto con contexto (mesa/tenant/pedido)
// para poder depurarlo desde el log del servidor.
const GENERIC_ERROR = "No se pudo procesar el pedido";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    lines?: { productId: string; quantity: number; extraIds: string[]; notes: string | null }[];
  };

  // LA MESA NO LA ELIGE EL CLIENTE. Sale de la cookie httpOnly que fijó el QR al escanearlo
  // (ver `lib/mesa-cookie.ts`), no del cuerpo de la petición: si viniera del navegador,
  // cualquiera podría mandar comandas a la mesa que quisiera con solo cambiar un campo.
  const tableToken = await readMesaToken();

  if (!tableToken || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  let table: Awaited<ReturnType<typeof findTableByToken>>;
  try {
    table = await findTableByToken(tableToken);
  } catch (error) {
    console.error("[orders] Error resolviendo mesa por token:", error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  if (!table?.isActive) {
    return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  }

  // RATE-LIMIT POR MESA. Sin esto, quien fotografíe un QR puede repetir esta petición sin
  // límite y saturar la impresora de cocina (que ve la comanda en cuanto existe, pagada o
  // no). Se limita por `table.id` -- el eje del abuso es la mesa -- y va DESPUÉS de resolver
  // la mesa para no gastar cuota con un token inválido, pero ANTES de crear el pedido o
  // tocar Stripe. Falla CERRADO: si el contador no responde, se rechaza en vez de dejar
  // pasar (la disponibilidad del rate-limit no puede convertirse en la vía de saltárselo).
  let permitido: boolean;
  try {
    permitido = await checkOrderRateLimit(table.id);
  } catch (error) {
    console.error(`[orders] Rate-limit no disponible (mesa ${table.id}):`, error);
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
    settings = await getTenantSettings(table.tenantId);
  } catch (error) {
    console.error(`[orders] Error leyendo ajustes del tenant ${table.tenantId}:`, error);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  const taxRate = Number((settings?.fiscal as { taxRate?: number } | undefined)?.taxRate ?? 0.1);

  let order: Awaited<ReturnType<typeof createPendingOrder>>;
  try {
    order = await createPendingOrder({
      tenantId: table.tenantId,
      venueId: table.venueId,
      tableId: table.id,
      lines: body.lines,
      taxRate,
    });
  } catch (error) {
    // Solo un `OrderCartError` describe algo que el comensal puede corregir (una
    // línea de SU carrito); cualquier otra cosa (Postgres, RPC, config del
    // tenant) es interna y se colapsa al mensaje genérico.
    if (error instanceof OrderCartError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error(
      `[orders] Error creando pedido pendiente (mesa ${table.id}, tenant ${table.tenantId}):`,
      error,
    );
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  // A partir de aquí el pedido `pending` ya existe. Si cualquier paso del cobro
  // falla, ese pedido queda huérfano (nunca tendrá payment intent) salvo que se
  // marque explícitamente `cancelled` -- ver `cancelOrphanedPendingOrder`. Esto NO
  // es un riesgo económico: el cliente nunca llega a recibir `client_secret`, así
  // que ese PaymentIntent (si llegó a crearse) jamás puede confirmarse.
  try {
    // Forma Connect: si el tenant tiene cuenta conectada, el cargo se crea SOBRE
    // ella y el dinero va a su cuenta, no a la de la plataforma. Sin cuenta
    // conectada (desarrollo local, o un tenant que aún no ha completado el
    // onboarding) se cobra contra la cuenta de la plataforma.
    const connectedAccount = await getTenantStripeAccount(table.tenantId);

    const intent = await stripeClient().paymentIntents.create(
      {
        amount: order.totalCents,
        currency: order.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: { order_id: order.orderId, tenant_id: table.tenantId },
      },
      connectedAccount ? { stripeAccount: connectedAccount } : undefined,
    );

    await attachPaymentIntent(table.tenantId, order.orderId, intent.id);

    return NextResponse.json({
      clientSecret: intent.client_secret,
      publicToken: order.publicToken,
      // La cuenta conectada del cliente, o null. NO es un secreto -- es el `acct_...` que ya
      // recibe el dinero -- y el front LO NECESITA: un cargo directo sobre una cuenta
      // conectada solo se puede confirmar si Stripe.js se inicializa contra esa misma cuenta.
      // Sin esto, un tenant con Connect vería el formulario de pago fallar al confirmar.
      connectedAccount,
    });
  } catch (error) {
    console.error(
      `[orders] Error creando el cobro para el pedido ${order.orderId} (tenant ${table.tenantId}); marcando cancelado:`,
      error,
    );
    try {
      await cancelOrphanedPendingOrder(table.tenantId, order.orderId);
    } catch (cancelError) {
      console.error(
        `[orders] Además, no se pudo marcar cancelado el pedido huérfano ${order.orderId}:`,
        cancelError,
      );
    }
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
