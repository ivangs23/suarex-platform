import { renderEscPos } from "@suarex/printing";
import type { BrowserWindow } from "electron";
import { loadWinspoolBinding, makeUsbSink } from "./usb-sink-winspool.js";

/** Impresoras instaladas en Windows, por su `name` (el que el owner teclea en el panel).
 * Usa la API nativa de Electron -- sin FFI. */
export async function listLocalPrinters(win: BrowserWindow): Promise<string[]> {
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((p) => p.name);
}

/** Un ticket ESC/POS fijo de prueba: cabecera + línea + corte. Ejercita el camino RAW sin
 * la nube ni un pedido. Solo en Windows; en otra plataforma lanza para que la UI lo diga.
 * Construye un sink local (no pasa por `registerUsbRawSink`/`printToPrinter`, que exigen
 * una `PrinterConfig` completa): para un disparo puntual de diagnóstico basta con abrir,
 * escribir y cerrar directamente contra el binding winspool. */
export async function printTestTicket(printerName: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("La impresión USB solo está disponible en Windows.");
  }
  const sink = makeUsbSink(await loadWinspoolBinding());
  const bytes = renderEscPos([
    { kind: "text", text: "SUAREX", align: "center", bold: true },
    { kind: "text", text: "Ticket de prueba", align: "center" },
    { kind: "text", text: new Date().toISOString(), align: "left" },
    { kind: "cut" },
  ]);
  await sink(bytes, printerName);
}
