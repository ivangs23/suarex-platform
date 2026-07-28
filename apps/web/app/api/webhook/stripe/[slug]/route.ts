import { findTenantBySlug, getStripeCredentials, markOrderPaid } from "@suarex/db";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeClientWithKey } from "@/lib/stripe";

// `constructEvent` usa criptografía de Node; el runtime edge no sirve aquí.
export const runtime = "nodejs";

/**
 * WEBHOOK DE STRIPE DE UN NEGOCIO CONCRETO.
 *
 * Cada negocio cobra en su PROPIA cuenta, y cada cuenta firma sus eventos con SU secreto. Para
 * verificar una firma hay que saber de antemano con qué secreto hacerlo, y eso no se puede
 * deducir del evento sin haberlo verificado antes -- el pez que se muerde la cola. La salida es
 * que lo diga la URL: cada cuenta de Stripe apunta a `/api/webhook/stripe/<su-slug>`.
 *
 * El slug de la URL lo controla quien llama, y no pasa nada: solo elige CON QUÉ SECRETO se
 * verifica. Un slug equivocado hace que la firma no cuadre y la petición se rechaza. No abre
 * ninguna puerta -- lo que abre puertas es no poder verificar, que es justo lo que esto arregla.
 *
 * La ruta sin slug sigue existiendo para los negocios que cobran con las credenciales del
 * entorno. Desaparecerá cuando todos tengan las suyas.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const tenant = await findTenantBySlug(slug).catch(() => null);
  /* Un negocio que no existe se responde igual que uno con la firma mal: sin decir cuál de las
     dos cosas ha pasado. Contestar distinto convertiría este endpoint en una forma cómoda de
     averiguar qué clientes hay dados de alta. */
  if (!tenant) return NextResponse.json({ error: "Firma inválida" }, { status: 400 });

  const credenciales = await getStripeCredentials(tenant.id);
  if (!credenciales.secretKey || !credenciales.webhookSecret) {
    /* Sin sus credenciales no se puede verificar nada. Es un 500 y no un 400 porque el fallo es
       NUESTRO -- alguien apuntó un webhook aquí sin terminar de configurarlo -- y porque Stripe
       reintenta los 5xx: cuando se complete la configuración, los eventos pendientes entrarán
       solos en vez de haberse perdido. */
    return NextResponse.json({ error: "Sin configurar" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Sin firma" }, { status: 400 });

  // El cuerpo debe leerse crudo: verificar la firma sobre el JSON reserializado falla.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClientWithKey(credenciales.secretKey).webhooks.constructEvent(
      payload,
      signature,
      credenciales.webhookSecret,
    );
  } catch {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    /* Acotado al negocio dueño de ESTE webhook. Un id de PaymentIntent solo existe dentro de la
       cuenta que lo creó, así que la colisión es teórica -- pero aquí se sabe de quién es el
       evento, y no usar ese dato sería tirar gratis una capa de aislamiento. */
    const outcome = await markOrderPaid(paymentIntent.id, tenant.id);

    // 200 en los tres desenlaces: un error haría que Stripe reintentara un evento que ya está
    // resuelto (o que no le corresponde a nadie), y eso solo genera ruido, no arregla nada.
    return NextResponse.json({ received: true, outcome });
  }

  return NextResponse.json({ received: true });
}
