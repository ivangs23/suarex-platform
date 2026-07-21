import {
  attachPaymentIntent,
  createPendingOrder,
  findTableByToken,
  getTenantSettings,
  getTenantStripeAccount,
} from "@suarex/db";
import { NextResponse } from "next/server";
import { stripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    tableToken?: string;
    lines?: { productId: string; quantity: number; extraIds: string[]; notes: string | null }[];
  };

  if (!body.tableToken || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  const table = await findTableByToken(body.tableToken);
  if (!table?.isActive) {
    return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  }

  const settings = await getTenantSettings(table.tenantId);
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo crear el pedido" },
      { status: 422 },
    );
  }

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
  });
}
