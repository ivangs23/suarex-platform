import { markOrderDisputed, markOrderPaid, markOrderRefunded } from "@suarex/db";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeClient } from "@/lib/stripe";

// `constructEvent` usa criptografía de Node; el runtime edge no sirve aquí.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Sin configurar" }, { status: 500 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Sin firma" }, { status: 400 });

  // El cuerpo debe leerse crudo: verificar la firma sobre el JSON reserializado falla.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const outcome = await markOrderPaid(paymentIntent.id);

    // Se responde 200 en los tres casos: devolver un error haría que Stripe
    // reintentara indefinidamente algo que no va a cambiar. Pero un pedido
    // inexistente no es benigno -- significa que se cobró algo de lo que este
    // sistema no tiene registro, o que el webhook apunta al entorno equivocado --
    // así que se registra de forma distinguible.
    if (outcome === "order-not-found") {
      console.error(`[stripe-webhook] PaymentIntent sin pedido asociado: ${paymentIntent.id}`);
    }
  }

  // DINERO QUE VUELVE. Sin esto, un reembolso hecho en el dashboard de Stripe no llegaba
  // nunca y el pedido se quedaba `paid` para siempre: la base mentía sobre el dinero y
  // cuadrar la caja exigía mirar Stripe a mano.
  //
  // Se escucha `charge.refunded` y no `refund.created`: el primero trae el cargo con
  // `amount_refunded` ACUMULADO, que es el dato que hay que guardar cuando hay varios
  // reembolsos parciales sobre el mismo cobro. `refund.created` traería solo el último y
  // habría que sumarlos a mano, con el riesgo de contar dos veces un reintento.
  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const paymentIntentId =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : (charge.payment_intent?.id ?? null);

    if (!paymentIntentId) {
      console.error(`[stripe-webhook] Cargo reembolsado sin PaymentIntent: ${charge.id}`);
    } else {
      const outcome = await markOrderRefunded(paymentIntentId, charge.amount_refunded);
      if (outcome === "order-not-found") {
        console.error(
          `[stripe-webhook] Reembolso sin pedido asociado: ${paymentIntentId} (cargo ${charge.id})`,
        );
      }
    }
  }

  // Una DISPUTA no es un reembolso: el banco retiene el dinero mientras decide y el pedido
  // puede acabar cobrado. Se marca aparte para que el estado no mienta en ninguna dirección,
  // y se registra siempre -- una disputa es algo que hay que mirar, no un evento rutinario.
  if (event.type === "charge.dispute.created") {
    const dispute = event.data.object as Stripe.Dispute;
    const paymentIntentId =
      typeof dispute.payment_intent === "string"
        ? dispute.payment_intent
        : (dispute.payment_intent?.id ?? null);

    console.error(
      `[stripe-webhook] DISPUTA abierta: ${dispute.id} sobre ${paymentIntentId ?? "(sin PI)"}, ` +
        `motivo ${dispute.reason}`,
    );
    if (paymentIntentId) await markOrderDisputed(paymentIntentId);
  }

  return NextResponse.json({ received: true });
}
