import { listDevices, listVenues } from "@suarex/db";
import { requireManager } from "@/lib/require-manager";
import { DeviceForm } from "./DeviceForm";
import { DeviceRow } from "./DeviceRow";

/**
 * Pantalla de gestión de dispositivos (Task 5, fase D2): `requireManager()` es la
 * primera barrera; `createDeviceAction`/`regeneratePairingCodeAction`/`deleteDeviceAction`
 * (`actions.ts`) vuelven a comprobarlo por su cuenta vía `managerAction`, así que esta
 * página nunca es la única guarda.
 *
 * `listVenues` se usa dos veces aquí: para auto-rellenar el `venue_id` del formulario de
 * alta con el local por defecto del tenant (esta fase no gestiona locales, ver
 * `packages/db/src/venues.ts`), y para traducir el `venueId` de cada dispositivo a un
 * nombre legible en la lista.
 */
export default async function AdminDispositivosPage() {
  const session = await requireManager();

  const [devices, venues] = await Promise.all([
    listDevices(session.tenantId),
    listVenues(session.tenantId),
  ]);

  const venueNameById = new Map(venues.map((venue) => [venue.id, venue.name]));
  const defaultVenueId = venues.find((venue) => venue.isDefault)?.id ?? venues[0]?.id;

  return (
    <main>
      <h1>Gestión de dispositivos</h1>

      {devices.length === 0 ? <p>Todavía no hay dispositivos.</p> : null}

      {devices.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          venueName={venueNameById.get(device.venueId) ?? device.venueId}
        />
      ))}

      {defaultVenueId ? (
        <DeviceForm venueId={defaultVenueId} />
      ) : (
        <p>
          Este tenant todavía no tiene un local configurado; no se pueden dar de alta dispositivos
          hasta que exista uno.
        </p>
      )}
    </main>
  );
}
