"use client";

import type { DiaDeLaSemana, FichaPublica } from "@suarex/db";
import { startTransition, useActionState } from "react";
import { type FichaState, guardarFichaAction } from "./actions";

type Dia = { codigo: DiaDeLaSemana; nombre: string };

/**
 * «Ficha pública del local»: dirección, teléfono y horario de UNA sede, lo que la carta y los
 * buscadores enseñan. Lo vacío no se publica. Con varias sedes, el selector recarga la página con
 * `?sede=`, que es lo que precarga su ficha.
 *
 * Se envía con `startTransition` y no con `action={...}`: React vacía el formulario tras una
 * acción, y con un error de validación quien rellena perdería todo lo escrito.
 */
export function FichaForm({
  sedes,
  venueId,
  ficha,
  dias,
}: {
  sedes: { id: string; name: string }[];
  venueId: string;
  ficha: FichaPublica;
  dias: Dia[];
}) {
  const [state, action, pending] = useActionState<FichaState, FormData>(guardarFichaAction, {});

  return (
    <section data-testid="ficha-publica">
      <h2>Ficha pública del local</h2>
      <p>Lo que la carta y los buscadores enseñan de tu local. Lo que dejes vacío no se publica.</p>

      {sedes.length > 1 ? (
        <form method="get">
          <label htmlFor="ficha-sede">Sede</label>
          <select id="ficha-sede" name="sede" defaultValue={venueId}>
            {sedes.map((sede) => (
              <option key={sede.id} value={sede.id}>
                {sede.name}
              </option>
            ))}
          </select>
          <button type="submit">Ver su ficha</button>
        </form>
      ) : null}

      <form
        data-testid="ficha-form"
        onSubmit={(evento) => {
          evento.preventDefault();
          const datos = new FormData(evento.currentTarget);
          startTransition(() => action(datos));
        }}
      >
        <input type="hidden" name="venue_id" value={venueId} />
        <fieldset>
          <legend>Dirección y teléfono</legend>
          <label>
            Dirección
            <input name="ficha_street" defaultValue={ficha.street ?? ""} maxLength={160} />
          </label>
          <label>
            Código postal
            <input name="ficha_postal_code" defaultValue={ficha.postalCode ?? ""} maxLength={12} />
          </label>
          <label>
            Ciudad
            <input name="ficha_city" defaultValue={ficha.city ?? ""} maxLength={80} />
          </label>
          <label>
            Provincia
            <input name="ficha_region" defaultValue={ficha.region ?? ""} maxLength={80} />
          </label>
          <label>
            Teléfono
            <input name="ficha_phone" type="tel" defaultValue={ficha.phone ?? ""} maxLength={30} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Horario</legend>
          <p>
            Un día sin horas ni «Cerrado» no se publica. Si cierras pasada la medianoche, pon esa
            hora (20:00 a 02:00).
          </p>
          {dias.map(({ codigo, nombre }) => {
            const tramos = ficha.openingHours?.[codigo];
            return (
              <fieldset key={codigo} data-testid={`horario-${codigo}`}>
                <legend>{nombre}</legend>
                <label>
                  <input
                    type="checkbox"
                    name={`h_${codigo}_cerrado`}
                    defaultChecked={tramos?.length === 0}
                  />
                  Cerrado
                </label>
                {[1, 2].map((n) => (
                  <span key={n}>
                    <input
                      type="time"
                      name={`h_${codigo}_${n}_desde`}
                      aria-label={`${nombre}, tramo ${n}, abre`}
                      defaultValue={tramos?.[n - 1]?.[0] ?? ""}
                    />
                    {" a "}
                    <input
                      type="time"
                      name={`h_${codigo}_${n}_hasta`}
                      aria-label={`${nombre}, tramo ${n}, cierra`}
                      defaultValue={tramos?.[n - 1]?.[1] ?? ""}
                    />
                  </span>
                ))}
              </fieldset>
            );
          })}
        </fieldset>

        {state.error ? <p role="alert">{state.error}</p> : null}
        {state.ok && !pending ? <p role="status">Ficha guardada.</p> : null}
        <button type="submit" disabled={pending}>
          Guardar ficha
        </button>
      </form>
    </section>
  );
}
