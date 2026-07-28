import { markOrderPaid } from "@suarex/db";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeClientWithKey, stripeEnvCredentials } from "@/lib/stripe";

// `constructEvent` usa criptografía de Node; el runtime edge no sirve aquí.
export const runtime = "nodejs";

export async function POST(request: Request) {
  /* Sigue verificando con las credenciales del ENTORNO, igual que hasta ahora. Verificar una firma
     exige saber de antemano con qué secreto, y eso no se puede deducir de un evento que aún no se
     ha verificado -- el pez que se muerde la cola. La salida es una ruta por negocio, donde el
     secreto se sabe por la URL; eso es la fase siguiente. Hasta entonces esta ruta solo sirve a
     los negocios que cobran con el entorno, que hoy son todos. */
  const entorno = stripeEnvCredentials();
  const secret = entorno.webhookSecret;
  if (!secret || !entorno.secretKey) {
    return NextResponse.json({ error: "Sin configurar" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Sin firma" }, { status: 400 });

  // El cuerpo debe leerse crudo: verificar la firma sobre el JSON reserializado falla.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClientWithKey(entorno.secretKey).webhooks.constructEvent(
      payload,
      signature,
      secret,
    );
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
