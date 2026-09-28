import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * LA INSTANCIA DE STRIPE.JS DEL NAVEGADOR, Y LA RAMA DE CONNECT.
 *
 * Si el tenant tiene cuenta conectada, el cargo se crea SOBRE ella (`stripeAccount`) y el
 * dinero va al restaurante en vez de a la plataforma. Un cargo directo así SOLO se puede
 * confirmar si Stripe.js se inicializó contra ESA misma cuenta: si no, el formulario se pinta,
 * el comensal mete la tarjeta y falla al confirmar.
 *
 * Vive en su propio módulo, y no dentro de `PaymentStep`, para poder probarlo. Es la rama que
 * usa todo cliente real -- la otra es el respaldo de desarrollo y de un tenant sin onboarding
 * terminado -- y en desarrollo nunca se ejercita, porque ahí no hay cuenta conectada.
 *
 * `loadStripe` devuelve una promesa que NO debe recrearse en cada render (`Elements` se
 * remontaría y perdería el formulario a medio rellenar), así que se memoiza. La clave incluye
 * la CUENTA además de la clave publicable: memoizar solo por clave publicable haría que un
 * segundo cobro reusara la instancia del primero y se confirmara contra la cuenta equivocada.
 */
const instancias = new Map<string, Promise<Stripe | null>>();

export function stripeFor(
  publishableKey: string,
  connectedAccount: string | null,
): Promise<Stripe | null> {
  const clave = `${publishableKey}::${connectedAccount ?? "platform"}`;
  let promesa = instancias.get(clave);
  if (!promesa) {
    promesa = loadStripe(
      publishableKey,
      connectedAccount ? { stripeAccount: connectedAccount } : undefined,
    );
    instancias.set(clave, promesa);
  }
  return promesa;
}

/** Vacía la memoización. Solo para los tests: en el navegador la caché vive lo que la pestaña. */
export function resetInstanciasStripe(): void {
  instancias.clear();
}
