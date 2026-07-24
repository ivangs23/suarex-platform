"use client";

import { useActionState } from "react";
import { type PaymentConfigState, setPaymentConfigAction } from "./actions";

/**
 * Formulario de la config Paytef. La clave secreta NUNCA se rellena con el valor guardado (no baja
 * al navegador): si ya hay una, el campo queda vacío y dejarlo así la conserva; solo se envía
 * cuando se teclea una nueva. `hasSecret` es lo único que sabe la UI sobre el secreto.
 */
export function PaymentConfigForm({
  accessKey,
  companyId,
  mock,
  hasSecret,
}: {
  accessKey: string;
  companyId: string;
  mock: boolean;
  hasSecret: boolean;
}) {
  const [state, action, pending] = useActionState<PaymentConfigState, FormData>(
    setPaymentConfigAction,
    {},
  );

  return (
    <form action={action} data-testid="payment-config-form">
      <label htmlFor="pay-access-key">Clave de acceso (access key)</label>
      <input
        id="pay-access-key"
        name="access_key"
        defaultValue={accessKey}
        required
        autoComplete="off"
      />

      <label htmlFor="pay-secret-key">Clave secreta (secret key)</label>
      <input
        id="pay-secret-key"
        name="secret_key"
        type="password"
        autoComplete="off"
        placeholder={hasSecret ? "•••••• (guardada -- déjalo en blanco para no cambiarla)" : ""}
      />

      <label htmlFor="pay-company-id">Company ID (opcional)</label>
      <input id="pay-company-id" name="company_id" defaultValue={companyId} autoComplete="off" />

      <label htmlFor="pay-mock">
        <input id="pay-mock" name="mock" type="checkbox" value="true" defaultChecked={mock} />
        Modo pruebas (no cobra de verdad)
      </label>

      {state.error ? (
        <p role="alert" data-testid="payment-config-error">
          {state.error}
        </p>
      ) : null}
      {state.ok ? <p data-testid="payment-config-ok">Configuración guardada.</p> : null}

      <button type="submit" disabled={pending} data-testid="payment-config-save">
        {pending ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
