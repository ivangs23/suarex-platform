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
