"use client";

import { useState } from "react";
import { createPrinterAction } from "./actions";

type DeviceOption = { id: string; name: string; printers: string[] };

/**
 * Alta de impresora. Client component para que el campo del nombre Windows sea un DESPLEGABLE
 * de las impresoras que el dispositivo elegido reportó en su heartbeat (`device.printers`), en
 * vez de un input de texto donde un typo hace que la USB no case y no imprima en silencio (#7).
 *
 * El desplegable es estricto SOLO cuando hay de dónde elegir: si el dispositivo aún no ha
 * reportado impresoras (recién emparejado, o sin device asignado), cae a un input de texto a
 * mano -- no se puede forzar a elegir de una lista vacía. Un botón "escribir a mano" deja el
 * escape aunque haya lista (p. ej. una impresora recién enchufada que el device todavía no ha
 * reportado). Ambos ramos usan `name="printer_name"`, así que `createPrinterAction` no cambia.
 *
 * `device_id` es opcional ("Sin dispositivo" -> cadena vacía -> `device_id: null`). `venue_id`
 * viaja oculto, igual que en `TableForm`/`DeviceForm`.
 */
export function PrinterForm({ venueId, devices }: { venueId: string; devices: DeviceOption[] }) {
  const [connectionType, setConnectionType] = useState("network");
  const [deviceId, setDeviceId] = useState("");
  const [manualEntry, setManualEntry] = useState(false);

  const reported = devices.find((d) => d.id === deviceId)?.printers ?? [];
  const useDropdown = reported.length > 0 && !manualEntry;

  return (
    <form action={createPrinterAction}>
      <h3>Nueva impresora</h3>
      <input type="hidden" name="venue_id" value={venueId} />

      <label htmlFor="printer-name">Nombre</label>
      <input id="printer-name" name="name" type="text" required />

      <label htmlFor="printer-connection-type">Tipo de conexión</label>
      <select
        id="printer-connection-type"
        name="connection_type"
        value={connectionType}
        onChange={(e) => setConnectionType(e.target.value)}
      >
        <option value="network">Red (IP:puerto)</option>
        <option value="usb">USB (impresora de Windows)</option>
      </select>

      <label htmlFor="printer-device">Dispositivo (opcional)</label>
      <select
        id="printer-device"
        name="device_id"
        value={deviceId}
        onChange={(e) => setDeviceId(e.target.value)}
      >
        <option value="">Sin dispositivo</option>
        {devices.map((device) => (
          <option key={device.id} value={device.id}>
            {device.name}
          </option>
        ))}
      </select>

      {connectionType === "network" ? (
        <>
          <label htmlFor="printer-host">Host</label>
          <input id="printer-host" name="host" type="text" />

          <label htmlFor="printer-port">Puerto</label>
          <input id="printer-port" name="port" type="number" min="1" max="65535" />
        </>
      ) : (
        <>
          <label htmlFor="printer-printername">Nombre de impresora Windows (solo USB)</label>
          {useDropdown ? (
            <select id="printer-printername" name="printer_name">
              {reported.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input id="printer-printername" name="printer_name" type="text" />
          )}
          {reported.length > 0 ? (
            <button type="button" onClick={() => setManualEntry((m) => !m)}>
              {manualEntry ? "Elegir de la lista" : "Escribir a mano"}
            </button>
          ) : deviceId ? (
            <p>
              Este dispositivo aún no ha reportado impresoras. Empareja el agente y espera unos
              segundos, o escribe el nombre exacto a mano.
            </p>
          ) : null}
        </>
      )}

      <label htmlFor="printer-destination">Destino</label>
      <select id="printer-destination" name="destination" defaultValue="cocina">
        <option value="cocina">Cocina</option>
        <option value="barra">Barra</option>
        <option value="all">Todos</option>
      </select>

      <button type="submit">Crear impresora</button>
    </form>
  );
}
