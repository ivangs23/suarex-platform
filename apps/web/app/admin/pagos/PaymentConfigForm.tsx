"use client";

import { accountFields, type PaymentProviderInfo } from "@suarex/payments";
import { useActionState, useState } from "react";
import { type PaymentConfigState, setPaymentConfigAction } from "./actions";

/**
 * Formulario del método de pago, PINTADO A PARTIR DE LO QUE EL PROVEEDOR DECLARA.
 *
 * Aquí no hay ni un campo escrito a mano, y ese es el objetivo: añadir un método de pago mañana es
 * escribir su declaración (`@suarex/payments`) y su implementación de cobro en el agente. Esta
 * pantalla se entera sola. Cuando un formulario de ajustes se escribe a mano, lo que pasa es que
 * el proveedor nuevo llega con un campo que nadie pintó y no hay forma de configurarlo.
 *
 * Los campos `secret` NUNCA se rellenan con el valor guardado (no baja al navegador): si ya hay
 * uno, el campo queda vacío y dejarlo así lo conserva. `secretsSet` es lo único que la pantalla
 * sabe de los secretos -- cuáles están puestos, jamás su valor.
 *
 * Los campos `terminal` tampoco salen: van en la ficha del dispositivo, porque son del aparato y
 * no de la cuenta.
 */
export function PaymentConfigForm({
  providers,
  provider,
  config,
  secretsSet,
  mock,
}: {
  providers: PaymentProviderInfo[];
  provider: string;
  config: Record<string, string>;
  secretsSet: string[];
  mock: boolean;
}) {
  const [state, action, pending] = useActionState<PaymentConfigState, FormData>(
    setPaymentConfigAction,
    {},
  );
  const [elegido, setElegido] = useState(provider || (providers[0]?.id ?? ""));
  const actual = providers.find((p) => p.id === elegido) ?? providers[0];

  if (!actual) return <p>No hay ningún método de pago disponible.</p>;

  return (
    <form action={action} data-testid="payment-config-form">
      <label htmlFor="pay-provider">Método de pago</label>
      <select
        id="pay-provider"
        name="provider"
        value={elegido}
        onChange={(evento) => setElegido(evento.target.value)}
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      {/* Se dice ANTES de configurarlo, no el día que se va la luz. */}
      {!actual.canPollSession ? (
        <p data-testid="payment-no-poll">
          Este método no permite consultar cómo acabó un cobro interrumpido. Si el totem se apaga a
          mitad de un pago, alguien tendrá que resolverlo a mano con el código de autorización.
        </p>
      ) : null}

      {accountFields(actual).map((field) => {
        const id = `pay-${field.name}`;
        const guardado = secretsSet.includes(field.name);
        return (
          <div key={`${actual.id}-${field.name}`}>
            <label htmlFor={id}>
              {field.label}
              {field.required ? "" : " (opcional)"}
            </label>
            <input
              id={id}
              name={field.name}
              type={field.type === "secret" ? "password" : "text"}
              autoComplete="off"
              // El valor guardado de un secreto no existe en el navegador: no hay nada que
              // rellenar, y el hueco vacío es exactamente lo que significa "no lo cambies".
              defaultValue={field.type === "secret" ? "" : (config[field.name] ?? "")}
              placeholder={
                field.type === "secret" && guardado
                  ? "•••••• (guardada — déjalo en blanco para no cambiarla)"
                  : undefined
              }
            />
            {field.help ? <p>{field.help}</p> : null}
          </div>
        );
      })}

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
