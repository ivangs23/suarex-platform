import { createPrinterAction } from "./actions";

type DeviceOption = { id: string; name: string; reportedPrinters: string[] };

/**
 * Alta de impresora de red. Formulario de servidor puro, mismo patrón que
 * `CategoryForm`/`TableForm`. `device_id` es opcional (ver `optionalString` en
 * `apps/web/lib/form-parse.ts`): la opción "Sin dispositivo" envía una cadena vacía, que
 * `createPrinterAction` interpreta como "sin dispositivo asignado" (`device_id: null`),
 * no como un campo a rechazar.
 *
 * `venue_id` viaja oculto, igual que en `TableForm`/`DeviceForm`: esta fase no gestiona
 * altas/bajas de locales.
 */
export function PrinterForm({ venueId, devices }: { venueId: string; devices: DeviceOption[] }) {
  return (
    <form action={createPrinterAction}>
      <h3>Nueva impresora</h3>
      <input type="hidden" name="venue_id" value={venueId} />

      <label htmlFor="printer-name">Nombre</label>
      <input id="printer-name" name="name" type="text" required />

      <label htmlFor="printer-connection-type">Tipo de conexión</label>
      <select id="printer-connection-type" name="connection_type" defaultValue="network">
        <option value="network">Red (IP:puerto)</option>
        <option value="usb">USB (impresora de Windows)</option>
      </select>

      <label htmlFor="printer-host">Host</label>
      <input id="printer-host" name="host" type="text" />

      <label htmlFor="printer-port">Puerto</label>
      <input id="printer-port" name="port" type="number" min="1" max="65535" />

      <label htmlFor="printer-printername">Nombre de impresora Windows (solo USB)</label>
      {/* Desplegable con lo que los PCs de cocina REPORTAN ver, no un campo libre: un typo
          en el nombre de la impresora significa que no imprime, y no falla de forma visible
          -- el agente simplemente busca un nombre que no existe.

          Sigue habiendo texto libre como respaldo, y no es un adorno: el desplegable está
          vacío hasta que el agente late por primera vez (o si su versión es anterior al
          reporte), y en ese hueco hay que poder configurar la impresora igualmente.

          `list` en vez de `<select>` a propósito: permite las dos cosas en un solo campo. */}
      <input id="printer-printername" name="printer_name" type="text" list="impresoras-vistas" />
      <datalist id="impresoras-vistas">
        {[...new Set(devices.flatMap((d) => d.reportedPrinters))].map((nombre) => (
          <option key={nombre} value={nombre} />
        ))}
      </datalist>

      <label htmlFor="printer-destination">Destino</label>
      <select id="printer-destination" name="destination" defaultValue="cocina">
        <option value="cocina">Cocina</option>
        <option value="barra">Barra</option>
        <option value="all">Todos</option>
      </select>

      <label htmlFor="printer-device">Dispositivo (opcional)</label>
      <select id="printer-device" name="device_id" defaultValue="">
        <option value="">Sin dispositivo</option>
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.name}
          </option>
        ))}
      </select>

      <button type="submit">Crear impresora</button>
    </form>
  );
}
