import { destinationsMissingPrinter, listDevices, listPrinters, listVenues } from "@suarex/db";
import { requireManager } from "@/lib/require-manager";
import { ConfirmDeleteForm } from "../catalogo/ConfirmDeleteForm";
import { deletePrinterAction } from "./actions";
import { PrinterForm } from "./PrinterForm";

/**
 * Pantalla de gestión de impresoras (Task 5, fase D2): `requireManager()` es la primera
 * barrera; `createPrinterAction`/`deletePrinterAction` (`actions.ts`) vuelven a
 * comprobarlo por su cuenta vía `managerAction`, así que esta página nunca es la única
 * guarda.
 *
 * `listDevices` alimenta el `<select>` opcional de dispositivo del formulario de alta --
 * D2 solo admite impresoras de red (`connection.type === "network"`, ver
 * `packages/db/src/admin-printers.ts`), así que `printer.connection.host`/`.port` son
 * siempre esos dos campos.
 */
export default async function AdminImpresorasPage() {
  const session = await requireManager();

  const [printers, devices, venues] = await Promise.all([
    listPrinters(session.tenantId),
    listDevices(session.tenantId),
    listVenues(session.tenantId),
  ]);
  const missing = await destinationsMissingPrinter(session.tenantId);

  const defaultVenueId = venues.find((venue) => venue.isDefault)?.id ?? venues[0]?.id;
  const deviceOptions = devices.map((device) => ({ id: device.id, name: device.name }));

  return (
    <main>
      <h1>Gestión de impresoras</h1>

      {missing.length > 0 ? (
        <p role="alert" data-testid="printer-warning">
          ⚠ No hay impresora habilitada para: {missing.join(", ")}. Los tickets de{" "}
          {missing.length === 1 ? "ese destino" : "esos destinos"} no se imprimen hasta que añadas
          una impresora habilitada.
        </p>
      ) : null}

      {printers.length === 0 ? <p>Todavía no hay impresoras.</p> : null}

      {printers.map((printer) => (
        <article key={printer.id} data-testid="admin-printer" data-printer-id={printer.id}>
          <h3>{printer.name}</h3>
          <p>
            {printer.connection.host}:{printer.connection.port} -- destino: {printer.destination}
            {printer.enabled ? null : " (deshabilitada)"}
          </p>
          <ConfirmDeleteForm
            action={deletePrinterAction}
            hiddenName="printer_id"
            hiddenValue={printer.id}
            confirmMessage={`Borrar la impresora "${printer.name}". Esta acción no se puede deshacer. ¿Continuar?`}
            label="Borrar impresora"
          />
        </article>
      ))}

      {defaultVenueId ? (
        <PrinterForm venueId={defaultVenueId} devices={deviceOptions} />
      ) : (
        <p>
          Este tenant todavía no tiene un local configurado; no se pueden dar de alta impresoras
          hasta que exista uno.
        </p>
      )}
    </main>
  );
}
