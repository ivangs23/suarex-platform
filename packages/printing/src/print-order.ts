import type { TicketLine } from "@suarex/ticket";
import { CharacterSet, PrinterTypes, ThermalPrinter } from "node-thermal-printer";
import type { PrinterConfig, PrintResult } from "./adapters/types.js";
import { renderEscPos } from "./render.js";

const MAX_TRIES = 3;
const RETRY_MS = 2000;
// El write() TCP resuelve en cuanto el kernel local acepta los bytes, no cuando
// el peer los procesa: en loopback esto deja una carrera real entre "execute()
// resuelto" y "el peer ya vio los bytes" (visible con el fake server: hasta 50/50
// fallos en 0ms, 0 fallos desde 5ms de margen en pruebas de estrés). Una espera
// corta tras el éxito evita declarar "impreso" antes de que el SO haya entregado
// de verdad — en una impresora real, por red, esto no añade latencia perceptible.
const SETTLE_MS = 20;

export function deviceKey(config: PrinterConfig): string {
  return `tcp::${config.host}:${config.port}`;
}

/**
 * Entrega las líneas a una impresora de red. Un ThermalPrinter FRESCO por intento
 * (un buffer contaminado tras un fallo reimprime basura), hasta MAX_TRIES con
 * back-off. No pre-sondea el socket: el puerto 9100 acepta una conexión a la vez,
 * y un ping compite con el `execute` real. Patrón de GARUM `ticket.ts:356-401`.
 */
export async function printToPrinter(
  lines: TicketLine[],
  config: PrinterConfig,
): Promise<PrintResult> {
  const buffer = renderEscPos(lines);
  let lastReason = "";

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: `tcp://${config.host}:${config.port}`,
        characterSet: CharacterSet.PC858_EURO,
        removeSpecialCharacters: false,
        options: { timeout: 5000 },
      });
      // `printer.raw()` envía directamente por red y NO deja el buffer en
      // `this.buffer` (bypassa el estado interno) — usamos setBuffer()+execute()
      // para que el buffer pre-renderizado sea justo lo que se transmite.
      printer.setBuffer(buffer);
      await printer.execute();
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      return { id: config.id, label: config.label, ok: true };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_TRIES) await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }

  return { id: config.id, label: config.label, ok: false, reason: lastReason };
}
