import { applySubscriptionState } from "@suarex/db";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { planStatusDeStripe } from "@/lib/billing-events";
import { stripeClient } from "@/lib/stripe";

// `constructEvent` usa criptografía de Node; el runtime edge no sirve aquí.
export const runtime = "nodejs";

/**
 * WEBHOOK DE LA SUSCRIPCIÓN DEL RESTAURANTE — lo que SuarEx le cobra a él, no lo que el
 * comensal paga por su comida (eso es `../route.ts`).
 *
 * Endpoint y secreto SEPARADOS del webhook de pagos a propósito: son dos fuentes distintas de
 * eventos y un secreto filtrado no debe servir para falsificar los de la otra.
 *
 * Se escuchan los tres eventos de suscripción y NO `invoice.payment_failed`: Stripe ya mueve
 * la suscripción a `past_due` y eso llega por `customer.subscription.updated`. Escuchar los dos
 * sería aplicar la misma decisión por dos caminos, con el riesgo de que cada uno la interprete
 * distinto.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
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

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    // `deleted` es una baja pase lo que pase: el `status` que viaja en ese evento puede ser
    // cualquiera, pero la suscripción ya no existe.
    const planStatus =
      event.type === "customer.subscription.deleted"
        ? ("canceled" as const)
        : planStatusDeStripe(sub.status);

    if (!planStatus) {
      // Estado que no cambia el servicio (`incomplete`, `paused`, o uno nuevo que Stripe
      // haya añadido). Se registra y se ignora: no tocar nada es el default seguro.
      console.info(`[billing-webhook] Estado ignorado '${sub.status}' para ${sub.id}`);
      return NextResponse.json({ received: true });
    }

    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const outcome = await applySubscriptionState(customerId, planStatus, sub.id);

    // 200 en los dos casos: devolver error haría que Stripe reintentara indefinidamente algo
    // que no va a cambiar. Pero un cliente sin tenant NO es benigno -- se está cobrando una
    // suscripción de la que este sistema no tiene registro, o el webhook apunta al entorno
    // equivocado -- así que se registra de forma distinguible. Mismo criterio que el webhook
    // de pagos del comensal.
    if (outcome === "tenant-no-encontrado") {
      console.error(`[billing-webhook] Cliente de Stripe sin tenant asociado: ${customerId}`);
    }
  }

  return NextResponse.json({ received: true });
}
