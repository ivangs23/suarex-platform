"use client";

import { useActionState } from "react";
import { type PaymentConfigState, setStripeConfigAction } from "./actions";

/**
 * Credenciales de Stripe del canal QR (la carta de mesa).
 *
 * Cada cliente tiene su PROPIA cuenta de Stripe, así que esto no es una preferencia: es lo que
 * determina a dónde va el dinero de sus comensales. Sin rellenarlo, el cobro sigue yendo por las
 * claves globales del servidor -- que es como funcionaba antes y por qué todos cobraban contra la
 * misma cuenta.
 *
 * Los tres campos son de naturaleza distinta y por eso se tratan distinto:
 *
 *   - La clave PÚBLICA no es un secreto. Su trabajo es bajar al navegador para montar el
 *     formulario de tarjeta, así que se muestra y se puede borrar a propósito.
 *   - La clave SECRETA y el secreto del WEBHOOK no vuelven nunca. Si ya hay uno guardado el campo
 *     queda vacío, y dejarlo así lo conserva.
 */
export function StripeConfigForm({
  publishableKey,
  secretsSet,
}: {
  publishableKey: string;
  /** Nombres de los secretos ya guardados. Nunca su valor. */
  secretsSet: string[];
}) {
  const [state, action, pending] = useActionState<PaymentConfigState, FormData>(
    setStripeConfigAction,
    {},
  );

  const guardado = (name: string) =>
    secretsSet.includes(name)
      ? "•••••• (guardada — déjalo en blanco para no cambiarla)"
      : undefined;

  return (
    <form action={action} data-testid="stripe-config-form">
      <label htmlFor="stripe-publishable">Clave pública</label>
      <input
        id="stripe-publishable"
        name="publishable_key"
        type="text"
        autoComplete="off"
        defaultValue={publishableKey}
        placeholder="pk_live_… o pk_test_…"
      />
      <p>La que monta el formulario de tarjeta en el móvil del comensal. No es secreta.</p>

      <label htmlFor="stripe-secret">Clave secreta</label>
      <input
        id="stripe-secret"
        name="secretKey"
        type="password"
        autoComplete="off"
        placeholder={guardado("secretKey") ?? "sk_live_… o sk_test_…"}
      />

      <label htmlFor="stripe-webhook">Secreto del webhook</label>
      <input
        id="stripe-webhook"
        name="webhookSecret"
        type="password"
        autoComplete="off"
        placeholder={guardado("webhookSecret") ?? "whsec_…"}
      />
      {/* Este es el que se olvida, y su olvido no se nota al cobrar: se nota en la cocina. */}
      <p>
        Sin él los cobros se harían, pero los pedidos no llegarían a marcarse pagados: el comensal
        pagaría y la comanda no saldría. Lo da Stripe al crear el endpoint del webhook.
      </p>

      {state.error ? (
        <p role="alert" data-testid="stripe-config-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p data-testid="stripe-config-ok">Credenciales guardadas.</p> : null}

      <button type="submit" disabled={pending} data-testid="stripe-config-save">
        {pending ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
