import { tenantScoped } from "./client.js";
import { listVenues } from "./venues.js";

type CategoryDestinationRow = { destination: "cocina" | "barra" | null };
type EnabledPrinterDestRow = { venue_id: string; destination: "cocina" | "barra" | "all" };

export type VenuePrinterGap = {
  venueId: string;
  venueName: string;
  destinations: ("cocina" | "barra")[];
};

/**
 * Por CADA local (venue) del tenant, los destinos que la carta USA (distinct
 * `categories.destination` -- las categorías son de tenant, así que el conjunto usado es
 * el MISMO para todos los locales) pero para los que ESE local no tiene ninguna impresora
 * HABILITADA que los cubra (una impresora de ese local con ese `destination`, o una
 * `'all'` de ese mismo local). Solo se devuelven los locales con un hueco no vacío.
 *
 * Fix (revisión final whole-branch, Finding 2 / spec línea ~112 "por local"): la versión
 * anterior calculaba la cobertura a nivel de TENANT (`covered`/`hasAll` mezclaban
 * impresoras de todos los locales), así que en un tenant con varios locales, que UN solo
 * local tuviera impresora de cocina bastaba para que el aviso desapareciera para TODOS --
 * incluido un local que en realidad no tiene ninguna impresora de cocina y cuyos tickets
 * de esa estación se siguen perdiendo en silencio (ver el trade-off de
 * `targetPrinterIds`/`reserve_printed` en `print-jobs.ts`). Ahora la cobertura se calcula
 * impresora-a-impresora DENTRO de cada local, así que un local mal configurado se reporta
 * aunque otro local del mismo tenant esté perfectamente cubierto.
 */
export async function destinationsMissingPrinter(tenantId: string): Promise<VenuePrinterGap[]> {
  const [venues, catRows, printerRows] = await Promise.all([
    listVenues(tenantId),
    tenantScoped("categories", tenantId)
      .select("destination")
      .then(({ data, error }) => {
        if (error) throw error;
        return data as unknown as CategoryDestinationRow[];
      }),
    tenantScoped("printers", tenantId)
      .select("venue_id, destination")
      .eq("enabled", true)
      .then(({ data, error }) => {
        if (error) throw error;
        return data as unknown as EnabledPrinterDestRow[];
      }),
  ]);

  // Los destinos usados por la carta son de nivel TENANT (categories no tiene venue_id),
  // así que este conjunto es el mismo para cada local que se evalúe abajo.
  const used = new Set<"cocina" | "barra">();
  for (const row of catRows) {
    if (row.destination === "cocina" || row.destination === "barra") used.add(row.destination);
  }
  if (used.size === 0) return [];

  const gaps: VenuePrinterGap[] = [];
  for (const venue of venues) {
    const venuePrinters = printerRows.filter((p) => p.venue_id === venue.id);
    const hasAll = venuePrinters.some((p) => p.destination === "all");
    const covered = new Set(venuePrinters.map((p) => p.destination));
    const missing = [...used].filter((dest) => !hasAll && !covered.has(dest));
    if (missing.length > 0) {
      gaps.push({ venueId: venue.id, venueName: venue.name, destinations: missing });
    }
  }
  return gaps;
}

type UsbPrinterRow = {
  id: string;
  name: string;
  device_id: string | null;
  connection: { type?: string };
};

/**
 * Impresoras USB HABILITADAS sin `device_id` asignado: como el agente solo reclama una USB
 * atada a su propio dispositivo (`packages/agent/src/run-agent.ts`), una USB sin `device_id`
 * no la imprime NINGÚN agente -- sus tickets se pierden en silencio. El panel de impresoras
 * lo señala, mismo espíritu que `destinationsMissingPrinter`: hacer visible una configuración
 * que dejaría pedidos sin imprimir.
 */
export async function usbPrintersWithoutDevice(
  tenantId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await tenantScoped("printers", tenantId)
    .select("id, name, device_id, connection")
    .eq("enabled", true);
  if (error) throw error;

  return (data as unknown as UsbPrinterRow[])
    .filter((p) => p.connection?.type === "usb" && p.device_id === null)
    .map((p) => ({ id: p.id, name: p.name }));
}

type UsbPrinterConDispositivoRow = {
  id: string;
  name: string;
  device_id: string | null;
  connection: { type?: string; printerName?: string };
};

export type UsbPrinterNoReportada = {
  id: string;
  /** Nombre que el gestor le puso a la impresora en el panel. */
  name: string;
  /** Nombre de Windows configurado, el que el agente busca y no encuentra. */
  printerName: string;
  /** Qué PC no la ve. Sin esto el aviso no es accionable: no se sabe dónde mirar. */
  deviceName: string;
};

/**
 * Impresoras USB habilitadas cuyo nombre de Windows NO aparece en la lista que reporta su
 * propio dispositivo.
 *
 * El panel ya ofrece un desplegable con lo que cada PC reporta ver, pero sigue habiendo texto
 * libre -- y tiene que haberlo: el desplegable está vacío hasta que el agente late por primera
 * vez, y en ese hueco hay que poder configurar la impresora igualmente. Un typo escrito ahí no
 * falla de forma visible: el agente pide a winspool un nombre que no existe y el ticket se
 * pierde. Esto lo detecta DESPUÉS, que es lo único que puede hacerse con un campo libre.
 *
 * Mismo espíritu que `usbPrintersWithoutDevice` y `destinationsMissingPrinter`: hacer visible
 * una configuración que deja pedidos sin imprimir.
 *
 * Dos silencios deliberados:
 *
 * - **Un dispositivo que todavía no ha reportado no acusa a nadie.** Una lista vacía significa
 *   "no sé" (agente recién instalado, o versión anterior al reporte), no "no existe". Tratarla
 *   como acusación llenaría el panel de avisos falsos el día del alta.
 * - **Una USB sin `device_id` tampoco.** Ya la cubre `usbPrintersWithoutDevice`, y dos avisos
 *   sobre la misma impresora dirían dos cosas distintas sin que ninguna sea la accionable.
 *
 * La comparación ignora mayúsculas porque Windows abre las impresoras por nombre sin
 * distinguirlas: avisar de algo que funciona enseña a ignorar los avisos, y entonces también se
 * ignora el que importa.
 */
export async function usbPrintersNotReported(tenantId: string): Promise<UsbPrinterNoReportada[]> {
  const [printers, devices] = await Promise.all([
    tenantScoped("printers", tenantId)
      .select("id, name, device_id, connection")
      .eq("enabled", true),
    tenantScoped("devices", tenantId).select("id, name, reported_printers"),
  ]);
  if (printers.error) throw printers.error;
  if (devices.error) throw devices.error;

  type DeviceRow = { id: string; name: string; reported_printers: string[] | null };
  const porDispositivo = new Map(
    (devices.data as unknown as DeviceRow[]).map((d) => [d.id, d] as const),
  );

  const avisos: UsbPrinterNoReportada[] = [];
  for (const p of printers.data as unknown as UsbPrinterConDispositivoRow[]) {
    if (p.connection?.type !== "usb" || p.device_id === null) continue;

    const dispositivo = porDispositivo.get(p.device_id);
    const reportadas = dispositivo?.reported_printers;
    if (!dispositivo || !reportadas || reportadas.length === 0) continue;

    const configurada = (p.connection.printerName ?? "").toLowerCase();
    if (reportadas.some((r) => r.toLowerCase() === configurada)) continue;

    avisos.push({
      id: p.id,
      name: p.name,
      printerName: p.connection.printerName ?? "",
      deviceName: dispositivo.name,
    });
  }
  return avisos;
}
