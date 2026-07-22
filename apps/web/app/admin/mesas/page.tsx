import { listTables, listVenues } from "@suarex/db";
import { headers } from "next/headers";
import { tableQrSvg } from "@/lib/qr";
import { requireManager } from "@/lib/require-manager";
import { ConfirmDeleteForm } from "../catalogo/ConfirmDeleteForm";
import { deleteTableAction } from "./actions";
import { QrView } from "./QrView";
import { TableForm } from "./TableForm";

/**
 * Composición de la URL del QR de una mesa: `{protocolo}://{host}/m/{token}`. El `host`
 * SIEMPRE sale de la cabecera `Host` de la petición actual (`headers()` de Next), NUNCA
 * de un campo de formulario ni de un parámetro de ruta controlado por el cliente --
 * mismo principio que `requireTenant()` ya aplica para resolver el tenant
 * (`apps/web/lib/tenant-context.ts`). Esto era deliberadamente responsabilidad de esta
 * pantalla (Task 5), no de Task 2 (`app/admin/mesas/actions.ts`): ver el docstring de
 * ese fichero.
 *
 * El protocolo no viaja en `Host` (esa cabecera nunca incluye esquema): se usa
 * `x-forwarded-proto` cuando existe (reverse proxy en producción) y se cae a "http" solo
 * para hosts `*.localhost` (el propio dev server, sin TLS, igual que usan
 * `admin-catalogo.spec.ts`/`playwright.config.ts`: `http://garum.localhost:3000`);
 * cualquier otro host sin `x-forwarded-proto` se asume servido tras HTTPS.
 */
function resolveOrigin(headerList: Awaited<ReturnType<typeof headers>>): string {
  const host = headerList.get("host") ?? "";
  const forwardedProto = headerList.get("x-forwarded-proto");
  const protocol =
    forwardedProto ?? (host.includes(".localhost") || host === "localhost" ? "http" : "https");
  return `${protocol}://${host}`;
}

/**
 * Pantalla de gestión de mesas (Task 5, fase D2): `requireManager()` es la primera
 * barrera (redirige a `/staff/login` si no es owner/admin del tenant resuelto por Host);
 * `createTableAction`/`deleteTableAction` (`actions.ts`) vuelven a comprobarlo por su
 * cuenta vía `managerAction`, así que esta página NUNCA es la única guarda.
 */
export default async function AdminMesasPage() {
  const session = await requireManager();
  const headerList = await headers();
  const origin = resolveOrigin(headerList);

  const [tables, venues] = await Promise.all([
    listTables(session.tenantId),
    listVenues(session.tenantId),
  ]);

  const defaultVenueId = venues.find((venue) => venue.isDefault)?.id ?? venues[0]?.id;

  const tablesWithQr = await Promise.all(
    tables.map(async (table) => ({
      table,
      svg: await tableQrSvg(`${origin}/m/${table.token}`),
    })),
  );

  return (
    <main>
      <h1>Gestión de mesas</h1>

      {tables.length === 0 ? <p>Todavía no hay mesas.</p> : null}

      {tablesWithQr.map(({ table, svg }) => (
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
            confirmMessage={`Borrar la mesa "${table.label}" invalida el QR que ya se haya impreso para ella: cualquier comensal que lo escanee después dejará de llegar a ninguna mesa (el token no se reutiliza, ver packages/db/src/admin-tables.ts). Esta acción no se puede deshacer. ¿Continuar?`}
            label="Borrar mesa"
          />
        </article>
      ))}

      {defaultVenueId ? (
        <TableForm venueId={defaultVenueId} />
      ) : (
        <p>
          Este tenant todavía no tiene un local configurado; no se pueden crear mesas hasta que
          exista uno.
        </p>
      )}
    </main>
  );
}
