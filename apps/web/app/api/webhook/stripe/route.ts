import { markOrderPaid } from "@suarex/db";
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

  return NextResponse.json({ received: true });
}
