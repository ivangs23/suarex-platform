import { getTenantCustomDomain, listTables, listVenues } from "@suarex/db";
import { headers } from "next/headers";
import { tableQrSvg } from "@/lib/qr";
import { dominioPropioRespondeAqui, origenDeLosQr } from "@/lib/qr-origin";
import { requireManager } from "@/lib/require-manager";
import { ConfirmDeleteForm } from "../catalogo/ConfirmDeleteForm";
import { deleteTableAction } from "./actions";
import { QrView } from "./QrView";
import { TableForm } from "./TableForm";

/**
 * Gestión de mesas. `requireManager()` es la primera barrera; las actions vuelven a
 * comprobarlo vía `managerAction`. Cada mesa tiene su QR (`{origen}/m/{token}`, con el
 * origen de `origenDeLosQr`); borrarla lo invalida para siempre.
 */
export default async function AdminMesasPage() {
  const session = await requireManager();
  const headerList = await headers();

  const [tables, venues, customDomain] = await Promise.all([
    listTables(session.tenantId),
    listVenues(session.tenantId),
    getTenantCustomDomain(session.tenantId),
  ]);

  const origin = origenDeLosQr({
    customDomain,
    host: headerList.get("host") ?? "",
    forwardedProto: headerList.get("x-forwarded-proto"),
  });
  const usaDominioPropio = customDomain !== null && origin === `https://${customDomain}`;
  const dominioListo = usaDominioPropio ? await dominioPropioRespondeAqui(customDomain) : true;

  const defaultVenueId = venues.find((venue) => venue.isDefault)?.id ?? venues[0]?.id;

  const tablesWithQr = await Promise.all(
    tables.map(async (table) => ({
      table,
      svg: await tableQrSvg(`${origin}/m/${table.token}`),
    })),
  );

  // Con una sola sede no se enseñan cabeceras: quien gestiona no tiene por qué saber qué es.
  const variasSedes = venues.length > 1;
  const grupos = venues
    .map((venue) => ({
      venue,
      mesas: tablesWithQr.filter(({ table }) => table.venueId === venue.id),
    }))
    .filter((grupo) => variasSedes || grupo.mesas.length > 0);

  return (
    <main>
      <h1>Gestión de mesas</h1>

      <p data-testid="qr-origin">
        Los QR llevan a <strong>{origin}</strong>.
        {usaDominioPropio && !dominioListo ? (
          <>
            {" "}
            <strong role="alert">
              Ese dominio todavía no apunta a SuarEx: un QR impreso ahora no llevará a la carta
              hasta que su DNS apunte aquí.
            </strong>
          </>
        ) : null}
      </p>

      {tables.length === 0 ? <p>Todavía no hay mesas.</p> : null}

      {grupos.map(({ venue, mesas }) => (
        <section key={venue.id} data-testid="admin-venue" data-venue-id={venue.id}>
          {variasSedes ? <h2>{venue.name}</h2> : null}
          {variasSedes && mesas.length === 0 ? <p>Esta sede todavía no tiene mesas.</p> : null}

          {mesas.map(({ table, svg }) => (
            <article key={table.id} data-testid="admin-table" data-table-id={table.id}>
              <h3>
                {table.label}
                {table.isActive ? null : " (inactiva)"}
              </h3>
              <QrView svg={svg} label={table.label} />
              <ConfirmDeleteForm
                action={deleteTableAction}
                hiddenName="table_id"
                hiddenValue={table.id}
                confirmMessage={`Borrar la mesa "${table.label}" invalida el QR que ya se haya impreso para ella: quien lo escanee después no llegará a ninguna mesa, aunque vuelvas a crear otra con el mismo nombre. No se puede deshacer. ¿Continuar?`}
                label="Borrar mesa"
              />
            </article>
          ))}
        </section>
      ))}

      {defaultVenueId ? (
        <TableForm venues={venues} defaultVenueId={defaultVenueId} />
      ) : (
        <p>
          Este negocio todavía no tiene una sede configurada; no se pueden crear mesas hasta que
          exista una.
        </p>
      )}
    </main>
  );
}
