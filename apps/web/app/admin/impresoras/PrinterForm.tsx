import { createPrinterAction } from "./actions";

type DeviceOption = { id: string; name: string };

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

      <label htmlFor="printer-host">Host</label>
      <input id="printer-host" name="host" type="text" required />

      <label htmlFor="printer-port">Puerto</label>
      <input id="printer-port" name="port" type="number" min="1" max="65535" required />

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
