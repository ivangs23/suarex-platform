import {
  destinationsMissingPrinter,
  listDevices,
  listPrinters,
  listVenues,
  usbPrintersWithoutDevice,
} from "@suarex/db";
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
 * el formulario (`PrinterForm`) ya soporta Red y USB (selector `connection_type`, fase
 * C2b-a Task 4). `connection` es una unión (`packages/db/src/admin-printers.ts`), así que
 * la fila distingue por `connection.type` para poder mostrar filas USB creadas desde el
 * formulario o fuera de él (agente, tests) sin romper el tipo.
 *
 * `usbPrintersWithoutDevice` (fase C2b-a Task 5) señala las USB habilitadas sin
 * `device_id`: ningún agente las reclama, así que sus tickets se pierden en silencio --
 * mismo espíritu que el aviso de `destinationsMissingPrinter`.
 */
export default async function AdminImpresorasPage() {
  const session = await requireManager();

  const [printers, devices, venues] = await Promise.all([
    listPrinters(session.tenantId),
    listDevices(session.tenantId),
    listVenues(session.tenantId),
  ]);
  const venueGaps = await destinationsMissingPrinter(session.tenantId);
  const usbSinDispositivo = await usbPrintersWithoutDevice(session.tenantId);

  const defaultVenueId = venues.find((venue) => venue.isDefault)?.id ?? venues[0]?.id;
  const deviceOptions = devices.map((device) => ({
    id: device.id,
    name: device.name,
    printers: device.printers,
  }));

  return (
    <main>
      <h1>Gestión de impresoras</h1>

      {venueGaps.length > 0 ? (
        <div role="alert" data-testid="printer-warning">
          {venueGaps.map((gap) => (
            <p key={gap.venueId}>
              ⚠ {gap.venueName}: no hay impresora habilitada para {gap.destinations.join(", ")}. Los
              tickets de {gap.destinations.length === 1 ? "ese destino" : "esos destinos"} en este
              local no se imprimen hasta que añadas una impresora habilitada.
            </p>
          ))}
        </div>
      ) : null}

      {usbSinDispositivo.length > 0 ? (
        <p role="alert" data-testid="usb-no-device-warning">
          ⚠ Impresora(s) USB sin dispositivo asignado:{" "}
          {usbSinDispositivo.map((p) => p.name).join(", ")}. No imprimen hasta que las ates a un
          dispositivo.
        </p>
      ) : null}

      {printers.length === 0 ? <p>Todavía no hay impresoras.</p> : null}

      {printers.map((printer) => (
        <article key={printer.id} data-testid="admin-printer" data-printer-id={printer.id}>
          <h3>{printer.name}</h3>
          <p>
            {printer.connection.type === "network"
              ? `${printer.connection.host}:${printer.connection.port}`
              : `USB: ${printer.connection.printerName}`}{" "}
            -- destino: {printer.destination}
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
