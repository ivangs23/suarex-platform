"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { type FormEvent, useState } from "react";
import { useCart } from "./CartProvider";
import styles from "./cart.module.css";

/**
 * EL COBRO DE LA TARJETA, DENTRO DEL PANEL DEL PEDIDO.
 *
 * Es el último paso del comensal: `checkout` ya ha creado el pedido (pending) y ha traído el
 * `clientSecret`; aquí se cobra la tarjeta con Stripe Elements, con el pedido a la vista. Al
 * confirmarse, el webhook de Stripe marca el pedido `paid` (ver `api/webhook/stripe`) y el
 * comensal pasa a su pantalla de estado.
 *
 * Modo de PRUEBAS: las claves son `pk_test`/`sk_test`. Tarjeta de test 4242 4242 4242 4242,
 * cualquier fecha futura y CVC. No se mueve dinero real.
 */

/**
 * `loadStripe` devuelve una promesa que NO debe recrearse en cada render (Elements re-montaría
 * y perdería el formulario a medio rellenar). Se memoiza por (clave publicable + cuenta
 * conectada): un cargo directo sobre la cuenta de un cliente solo se confirma si Stripe.js se
 * inicializó contra ESA cuenta, así que cada cuenta necesita su propia instancia.
 */
const instancias = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string, connectedAccount: string | null) {
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

export function PaymentStep() {
  const cart = useCart();
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (!cart?.pago) return null;

  // Sin clave publicable configurada no se puede pintar el formulario. Es un fallo de
  // despliegue, no del comensal: se le dice que no se puede cobrar y puede volver a su pedido.
  if (!publishableKey) {
    return (
      <div className={styles.sheetBody} data-testid="payment-step">
        <p className={styles.error} role="alert">
          {cart.strings.orderError}
        </p>
        <button type="button" className={styles.payBack} onClick={cart.cancelarPago}>
          {cart.strings.payBack}
        </button>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripeFor(publishableKey, cart.pago.connectedAccount)}
      options={{ clientSecret: cart.pago.clientSecret }}
    >
      <PaymentForm />
    </Elements>
  );
}

function PaymentForm() {
  const cart = useCart();
  const stripe = useStripe();
  const elements = useElements();
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!cart?.pago) return null;
  const t = cart.strings;

  async function onSubmit(evento: FormEvent) {
    evento.preventDefault();
    if (!stripe || !elements || !cart?.pago) return;

    setProcesando(true);
    setError(null);

    // `redirect: "if_required"`: con tarjeta (el caso normal en una mesa) el cobro se
    // resuelve aquí mismo sin salir de la página. `return_url` solo se usa para métodos que
    // SÍ exigen redirección (algún wallet); apunta ya a la pantalla de estado del pedido.
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/pedido/${cart.pago.publicToken}`,
      },
      redirect: "if_required",
    });

    if (err) {
      // Un error de tarjeta (fondos, datos) es del comensal y se le muestra tal cual lo da
      // Stripe; cualquier otro se colapsa a un mensaje genérico. El pedido sigue pending: no
      // se ha cobrado nada y puede reintentar o volver.
      setError(
        err.type === "card_error" || err.type === "validation_error"
          ? (err.message ?? t.payError)
          : t.payError,
      );
      setProcesando(false);
      return;
    }

    // Cobro aceptado. El webhook marcará `paid`; la pantalla de estado ya lo refleja al llegar.
    window.location.href = `/pedido/${cart.pago.publicToken}`;
  }

  return (
    <form className={styles.sheetBody} data-testid="payment-step" onSubmit={onSubmit}>
      <h2 className={styles.sheetTitle}>{t.payTitle}</h2>
      <PaymentElement />

      {error ? (
        <p className={styles.error} role="alert" data-testid="payment-error">
          {error}
        </p>
      ) : null}

      <div className={styles.paymentActions}>
        <button
          type="button"
          className={styles.payBack}
          data-testid="payment-back"
          disabled={procesando}
          onClick={cart.cancelarPago}
        >
          {t.payBack}
        </button>
        <button
          type="submit"
          className={styles.pay}
          data-testid="payment-submit"
          disabled={!stripe || procesando}
        >
          {procesando ? t.payProcessing : t.payNow.replace("{total}", cart.totalLabel)}
        </button>
      </div>
    </form>
  );
}
