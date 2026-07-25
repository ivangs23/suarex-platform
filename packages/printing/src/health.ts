import type { PrinterConfig } from "./adapters/types.js";
import { deviceKey } from "./print-order.js";
import { probeTcp } from "./probe-tcp.js";
import { enqueueByDevice } from "./queue.js";

/**
 * Lo que se sabe de una impresora AHORA MISMO.
 *
 * Son tres estados y no dos a propósito. `unknown` no es un `down` disfrazado: es "no tengo
 * evidencia", que es la situación real de una USB recién arrancada (winspool no se puede sondear
 * sin imprimir) o de un agente que lleva dos segundos vivo. Quien consume esto NO debe avisar al
 * cliente en `unknown` -- avisar sin evidencia es el camino corto a que el aviso se vuelva ruido
 * de fondo y nadie lo lea el día que sí importa.
 */
export type PrinterStatus =
  | { status: "ok"; checkedAt: number }
  | { status: "down"; reason: string; checkedAt: number }
  | { status: "unknown" };

/**
 * Un solo veredicto para un GRUPO de impresoras que hacen el mismo papel (p. ej. las dos que
 * pueden sacar el recibo de un local).
 *
 * Basta con que UNA responda para que el papel salga, así que un `ok` manda sobre cualquier
 * `down`: decir "caída" porque la segunda impresora de repuesto no contesta sería mentir al
 * cliente. Y un grupo vacío es `unknown`, no `down` -- un local sin impresora de recibos
 * configurada no tiene una avería, tiene otra configuración.
 */
export function aggregateStatus(statuses: PrinterStatus[]): PrinterStatus {
  const viva = statuses.find((s) => s.status === "ok");
  if (viva) return viva;
  const caidas = statuses.filter(
    (s): s is Extract<PrinterStatus, { status: "down" }> => s.status === "down",
  );
  if (caidas.length === 0) return { status: "unknown" };
  // La más reciente: es la que describe la situación de ahora.
  return caidas.reduce((a, b) => (a.checkedAt >= b.checkedAt ? a : b));
}

/** Evidencia mínima que alimenta el estado: exactamente la forma de `PrintResult`/`ProbeResult`. */
type Evidence = { ok: boolean; reason?: string };

export type PrinterHealth = {
  /**
   * Registra el desenlace de una ENTREGA real. Es la mejor evidencia que existe -- más fuerte
   * que cualquier sonda, porque una entrega completada prueba que la impresora aceptó los bytes,
   * no solo que acepta conexiones. Por eso el agente la llama tras cada ticket.
   */
  record(config: PrinterConfig, result: Evidence): void;
  /** Lo que se sabe de esta impresora, o `unknown` si no hay evidencia o la que hay ya caducó. */
  read(config: PrinterConfig): PrinterStatus;
  /**
   * Refresca sondeando las impresoras de RED que no tienen evidencia fresca DE QUE VAN BIEN. Va
   * por `enqueueByDevice`, la MISMA cola por dispositivo que usa la entrega, así que una sonda
   * nunca compite con un ticket en vuelo por el puerto 9100 -- espera su turno. Las USB no se
   * sondean: no hay forma de preguntarle a winspool sin mandarle papel, así que se quedan como
   * estén.
   *
   * Una impresora sana no se vuelve a sondear durante unos segundos (`DEFAULT_TRUST_OK_MS`); una
   * CAÍDA se sondea cada vez, que es lo que hace que recuperarse se note al latido siguiente --
   * justo cuando alguien acaba de enchufarla de nuevo y está mirando a ver si vuelve.
   */
  refresh(configs: PrinterConfig[]): Promise<void>;
};

/** Cuánto vale una evidencia antes de dejar de ser noticia. El latido refresca muy por debajo. */
export const DEFAULT_STALE_AFTER_MS = 90_000;

/**
 * Cuánto se fía `refresh` de un `ok` reciente antes de volver a sondear.
 *
 * No es lo mismo que `staleAfterMs`: aquélla dice cuánto tiempo se sigue CONTANDO lo que se sabe;
 * ésta, cada cuánto se vuelve a MIRAR. Diez segundos porque el consumidor es un totem con gente
 * delante: una impresora que se apaga justo después del último ticket tiene que notarse antes de
 * que el siguiente cliente termine de elegir, no minuto y medio después. El coste es una conexión
 * TCP por impresora cada diez segundos, que es exactamente lo que hace una entrega normal.
 */
const DEFAULT_TRUST_OK_MS = 10_000;

/**
 * El estado tal cual si su evidencia sigue viva, o `unknown` si ya caducó.
 *
 * Está aquí fuera y no solo dentro del monitor porque un estado VIAJA: el agente lo devuelve en
 * cada tick y quien lo guardó lo enseña un rato después. Caducar es responsabilidad de quien MIRA
 * el estado, no de quien lo produjo, y esta es la única definición de esa regla.
 */
export function stillFresh(
  status: PrinterStatus,
  now: number,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): PrinterStatus {
  if (status.status === "unknown") return status;
  return now - status.checkedAt > staleAfterMs ? { status: "unknown" } : status;
}

export function createPrinterHealth(deps?: {
  probe?: (config: PrinterConfig) => Promise<Evidence>;
  now?: () => number;
  staleAfterMs?: number;
  trustOkMs?: number;
}): PrinterHealth {
  const probe =
    deps?.probe ??
    ((config: PrinterConfig) =>
      config.adapter === "escpos-tcp"
        ? probeTcp(config.host, config.port)
        : Promise.resolve<Evidence>({ ok: false, reason: "no sondeable" }));
  const now = deps?.now ?? Date.now;
  const staleAfterMs = deps?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const trustOkMs = deps?.trustOkMs ?? DEFAULT_TRUST_OK_MS;

  const porDispositivo = new Map<string, PrinterStatus>();

  function guarda(config: PrinterConfig, result: Evidence): void {
    porDispositivo.set(
      deviceKey(config),
      result.ok
        ? { status: "ok", checkedAt: now() }
        : { status: "down", reason: result.reason ?? "sin motivo", checkedAt: now() },
    );
  }

  function lee(config: PrinterConfig): PrinterStatus {
    const estado = porDispositivo.get(deviceKey(config));
    // Caducada la evidencia, se dice "no sé" en vez de seguir afirmando lo de hace un rato:
    // una impresora que respondió hace diez minutos no prueba nada sobre la de ahora.
    return estado ? stillFresh(estado, now(), staleAfterMs) : { status: "unknown" };
  }

  return {
    record: guarda,
    read: lee,

    async refresh(configs) {
      const red = configs.filter((c) => c.adapter === "escpos-tcp");
      // Una sonda por DISPOSITIVO, no por config: dos impresoras lógicas apuntando al mismo
      // host:puerto son el mismo aparato, y sondearlo dos veces solo dobla el tráfico.
      const vistos = new Set<string>();
      await Promise.all(
        red
          .filter((config) => {
            const key = deviceKey(config);
            if (vistos.has(key)) return false;
            vistos.add(key);
            const estado = lee(config);
            // Solo se ahorra la sonda si consta viva Y hace poco: ver `DEFAULT_TRUST_OK_MS`.
            return estado.status !== "ok" || now() - estado.checkedAt > trustOkMs;
          })
          .map((config) =>
            enqueueByDevice(deviceKey(config), () => probe(config)).then(
              (result) => guarda(config, result),
              (error: unknown) =>
                guarda(config, {
                  ok: false,
                  reason: error instanceof Error ? error.message : String(error),
                }),
            ),
          ),
      );
    },
  };
}
