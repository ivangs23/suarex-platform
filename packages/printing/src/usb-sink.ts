/**
 * Hueco registrable de la entrega USB. `@suarex/printing` NO sabe cómo hablar con el
 * spooler de Windows (winspool): eso es un binding nativo, específico de Windows y de
 * Electron, que se registra en runtime desde la cáscara (fase C2b-b) o desde un test (con
 * un sink falso). Aislarlo aquí es lo que mantiene al agente, a la base de datos y a los
 * tests ignorantes del mecanismo real -- el agente construye una `PrinterConfig` USB y
 * llama a `printToPrinter`, y esta capa resuelve la entrega.
 *
 * El sink por defecto LANZA: en un host sin sink registrado (o no-Windows) la entrega USB
 * falla limpio, `printToPrinter` lo mapea a `ok:false`, y el pedido se reintenta sin
 * marcarse -- exactamente el mismo contrato que un fallo de entrega TCP.
 */
export type UsbRawSink = (buffer: Buffer, printerName: string) => Promise<void>;

const defaultSink: UsbRawSink = async () => {
  throw new Error(
    "impresión USB no disponible: no hay sink registrado (registerUsbRawSink) en esta plataforma",
  );
};

let currentSink: UsbRawSink = defaultSink;

/** Registra el sink de entrega USB. `null` restaura el sink por defecto (que lanza). */
export function registerUsbRawSink(sink: UsbRawSink | null): void {
  currentSink = sink ?? defaultSink;
}

/** Entrega interna: delega en el sink actual. No captura el error -- lo propaga a
 * `deliverUsb`/`printToPrinter`, que lo mapean a `ok:false`. */
export function usbRawSink(buffer: Buffer, printerName: string): Promise<void> {
  return currentSink(buffer, printerName);
}
