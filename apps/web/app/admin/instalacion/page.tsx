import {
  getPaymentConfigForManager,
  getTenantSettings,
  listAdminCatalog,
  listDevices,
  listPrinters,
  listTables,
  listVenues,
} from "@suarex/db";
import { findProvider, missingFields } from "@suarex/payments";
import { requireManager } from "@/lib/require-manager";
import { buildSetupChecklist, isSetupComplete, type SetupFacts } from "./checklist";

/**
 * PUESTA EN MARCHA: qué le falta a este cliente para poder vender.
 *
 * No es un asistente con sus propios formularios. Se pensó así al principio y se descartó: esos
 * formularios ya existen (catálogo, mesas, dispositivos, impresoras, pagos, ajustes), y copiarlos
 * aquí sería mantener dos versiones de cada uno. La que se queda vieja es siempre la del
 * asistente, porque se usa una vez por cliente y nadie vuelve a mirarla.
 *
 * Lo que de verdad falta el día de una instalación no es dónde escribir los datos: es SABER QUÉ
 * QUEDA. Así que esto es una lista de comprobaciones con estado, cada una enlazando a la pantalla
 * donde se arregla.
 *
 * La decisión de qué está listo vive en `buildSetupChecklist`, pura y probada aparte. Aquí solo se
 * reúnen los hechos.
 */
export default async function AdminInstalacionPage() {
  const session = await requireManager();

  const [settings, venues, catalog, tables, devices, printers, payment] = await Promise.all([
    getTenantSettings(session.tenantId),
    listVenues(session.tenantId),
    listAdminCatalog(session.tenantId),
    listTables(session.tenantId),
    listDevices(session.tenantId),
    listPrinters(session.tenantId),
    getPaymentConfigForManager(session.tenantId),
  ]);

  const ahora = Date.now();
  const provider = payment ? findProvider(payment.provider) : null;

  const facts: SetupFacts = {
    channels: settings?.channels ?? [],
    venueCount: venues.length,
    productCount: catalog.categories.reduce((total, cat) => total + cat.products.length, 0),
    tableCount: tables.length,
    devices: devices.map((device) => ({
      id: device.id,
      name: device.name,
      roles: device.roles,
      paired: device.pairedAt !== null,
      lastSeenAgoMs: device.lastSeenAt ? ahora - new Date(device.lastSeenAt).getTime() : null,
      terminalId: device.pinpadId,
    })),
    printers: printers.map((printer) => ({
      id: printer.id,
      name: printer.name,
      destination: printer.destination,
      enabled: printer.enabled,
      deviceId: printer.deviceId,
      network: (printer.connection as { type?: string } | null)?.type === "network",
    })),
    payment: {
      configured: payment !== null && provider !== null,
      /* Qué campos obligatorios están sin rellenar. Los secretos guardados no bajan al navegador,
         así que se cuentan por su nombre (`secretsSet`) y no por su valor -- que es justo lo que
         permite decir "falta la clave secreta" sin haberla leído nunca. */
      missing:
        payment && provider
          ? missingFields(
              provider,
              {
                ...payment.config,
                ...Object.fromEntries(payment.secretsSet.map((name) => [name, "guardado"])),
                // El terminal no vive en la cuenta sino en el dispositivo; se comprueba aparte.
                ...Object.fromEntries(
                  provider.configFields
                    .filter((field) => field.type === "terminal")
                    .map((field) => [field.name, "n/a"]),
                ),
              },
              payment.mock,
            )
          : [],
      mock: payment?.mock ?? true,
    },
  };

  const items = buildSetupChecklist(facts);
  const listo = isSetupComplete(items);

  return (
    <main>
      <h1>Puesta en marcha</h1>

      {listo ? (
        <p data-testid="setup-ready">
          Todo lo imprescindible está configurado. Antes de irte, haz un pedido de prueba y
          comprueba que sale el papel: eso es lo único que no se puede verificar desde aquí.
        </p>
      ) : (
        <p data-testid="setup-pending">
          Falta algo por configurar. Cada punto enlaza a donde se arregla.
        </p>
      )}

      <ul data-testid="setup-checklist">
        {items.map((item) => (
          <li key={item.id} data-testid="setup-item" data-status={item.status}>
            <strong>
              {item.status === "ok" ? "✔" : item.status === "aviso" ? "⚠" : "✕"} {item.label}
            </strong>
            {item.detail ? <span> — {item.detail}</span> : null}
            {item.href && item.status !== "ok" ? <a href={item.href}> Ir a configurarlo</a> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
