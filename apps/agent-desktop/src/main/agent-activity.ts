import type { AgentTickResult, PrintFailure } from "@suarex/agent";

/**
 * Estado acumulado de la impresión, para que la app deje de ser una caja negra: cuántos
 * tickets van, si el último tick reventó, y qué impresoras están caídas ahora mismo. Lo pinta
 * el renderer y lo resume la bandeja.
 */
export type AgentActivity = {
  lastTickAt: string | null;
  printedTotal: number;
  failedTotal: number;
  /** Error del tick entero (p. ej. sin red). Se limpia en cuanto un tick vuelve a ir bien. */
  lastError: string | null;
  /** Impresoras cuyo último intento de entrega falló. Se guarda `destination` (cocina/barra)
   *  porque es lo que el owner reconoce -- el `printerId` es un UUID que no le dice nada. */
  downPrinters: { printerId: string; destination: string; reason: string }[];
};

export const INITIAL_ACTIVITY: AgentActivity = {
  lastTickAt: null,
  printedTotal: 0,
  failedTotal: 0,
  lastError: null,
  downPrinters: [],
};

/**
 * Avisos a disparar TRAS este tick. Son transiciones, no estados: solo lo que CAMBIÓ, para no
 * repetir la misma notificación cada 4 s mientras una impresora sigue caída.
 */
export type ActivityAlerts = {
  /** Impresoras que acaban de caer (fallaron y no estaban ya marcadas como caídas). */
  newlyDown: PrintFailure[];
  /** Ids de impresoras que estaban caídas y en este tick han vuelto a imprimir. */
  recovered: string[];
};

/**
 * Funde un resultado de tick en el estado acumulado y calcula los avisos de transición. Puro:
 * no toca Electron ni el reloj (el instante entra como `nowIso`), así se prueba headless.
 *
 * Una impresora que en el MISMO tick imprime un pedido y falla otro se considera viva (la
 * entrega demuestra que responde): cuenta como recuperada, no como caída.
 */
export function reduceActivity(
  prev: AgentActivity,
  result: AgentTickResult,
  nowIso: string,
): { activity: AgentActivity; alerts: ActivityAlerts } {
  const prevDown = new Map(prev.downPrinters.map((d) => [d.printerId, d]));
  const succeeded = new Set(result.succeeded);

  const recovered = [...prevDown.keys()].filter((id) => succeeded.has(id));
  const newlyDown = result.failures.filter(
    (f) => !prevDown.has(f.printerId) && !succeeded.has(f.printerId),
  );

  const down = new Map(prevDown);
  for (const id of recovered) down.delete(id);
  for (const f of result.failures) {
    if (!succeeded.has(f.printerId)) {
      down.set(f.printerId, {
        printerId: f.printerId,
        destination: f.destination,
        reason: f.reason,
      });
    }
  }

  const activity: AgentActivity = {
    lastTickAt: nowIso,
    printedTotal: prev.printedTotal + result.printed,
    failedTotal: prev.failedTotal + result.failed,
    lastError: result.error ?? null,
    downPrinters: [...down.values()],
  };

  return { activity, alerts: { newlyDown, recovered } };
}
