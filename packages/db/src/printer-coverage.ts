import { tenantScoped } from "./client.js";

type CategoryDestinationRow = { destination: "cocina" | "barra" | null };
type EnabledPrinterDestRow = { destination: "cocina" | "barra" | "all" };

/**
 * Destinos que la carta del tenant USA (distinct `categories.destination`) pero para los
 * que NO hay ninguna impresora habilitada que los cubra (una impresora de ese `destination`
 * o una `'all'`). Un resultado no vacío es exactamente el caso de "estación sin impresora"
 * que hoy `unprintedPaidOrders`/`reserve_printed` tratan como trivialmente cubierto y
 * descartan en silencio (ver el trade-off documentado en `print-jobs.ts`): el panel de
 * impresoras lo muestra como aviso para que el `owner` lo corrija, cerrando el deferred item.
 * Es una comprobación de solo lectura; no cambia el comportamiento del agente.
 */
export async function destinationsMissingPrinter(
  tenantId: string,
): Promise<("cocina" | "barra")[]> {
  const { data: catRows, error: catError } = await tenantScoped("categories", tenantId).select(
    "destination",
  );
  if (catError) throw catError;

  const { data: printerRows, error: printerError } = await tenantScoped("printers", tenantId)
    .select("destination")
    .eq("enabled", true);
  if (printerError) throw printerError;

  const printers = printerRows as unknown as EnabledPrinterDestRow[];
  const hasAll = printers.some((p) => p.destination === "all");
  const covered = new Set(printers.map((p) => p.destination));

  const used = new Set<"cocina" | "barra">();
  for (const row of catRows as unknown as CategoryDestinationRow[]) {
    if (row.destination === "cocina" || row.destination === "barra") used.add(row.destination);
  }

  return [...used].filter((dest) => !hasAll && !covered.has(dest));
}
