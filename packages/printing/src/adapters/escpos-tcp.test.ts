import { afterEach, describe, expect, it } from "vitest";
import {
  type FakedPrinter,
  startFakePrinter,
} from "../../../../tests/helpers/fake-escpos-server.js";
import { printToPrinter } from "../print-order.js";
import type { PrinterConfig } from "./types.js";

let printer: FakedPrinter;
afterEach(async () => {
  await printer?.close();
});

const lines = [
  { kind: "text" as const, text: "COCINA", align: "center" as const, bold: true },
  { kind: "text" as const, text: "1x  Tosta", align: "left" as const },
  { kind: "cut" as const },
];

function configFor(printerRef: FakedPrinter): PrinterConfig {
  return {
    id: "p1",
    label: "Cocina",
    destination: "cocina",
    adapter: "escpos-tcp",
    host: "127.0.0.1",
    port: printerRef.port,
  };
}

// Espera hasta que la condición se cumpla o se agote el plazo. Se usa para
// sondear el estado del fake server (p.ej. `received()`) desde la prueba, en
// vez de que el adaptador de producción incluya una espera fija — la carrera
// de "el peer aún no vio los bytes" es un artefacto del harness en el mismo
// proceso, no algo que la entrega real deba absorber (ver comentario en
// print-order.ts).
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: se agotó el plazo esperando la condición");
    }
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe("printToPrinter (escpos-tcp)", () => {
  it("entrega los bytes a la impresora (texto + corte GS V)", async () => {
    printer = await startFakePrinter();
    const config = configFor(printer);

    const result = await printToPrinter(lines, config);

    expect(result.ok).toBe(true);
    await waitFor(() => printer.received().includes(Buffer.from("COCINA", "latin1")));
    expect(printer.received().includes(Buffer.from("COCINA", "latin1"))).toBe(true);
    expect(printer.received().includes(Buffer.from("Tosta", "latin1"))).toBe(true);
    // GS V 0 (0x1d 0x56 0x00): corte total emitido por printer.cut().
    expect(printer.received().includes(Buffer.from([0x1d, 0x56, 0x00]))).toBe(true);
  });

  it("devuelve ok:false si la impresora no está (conexión rechazada)", async () => {
    printer = await startFakePrinter();
    const port = printer.port;
    await printer.close();

    const config: PrinterConfig = {
      id: "p1",
      label: "Cocina",
      destination: "cocina",
      adapter: "escpos-tcp",
      host: "127.0.0.1",
      port,
    };

    const result = await printToPrinter(lines, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("se conecta una sola vez cuando todo va bien (sin duplicados)", async () => {
    printer = await startFakePrinter();
    const config = configFor(printer);

    const result = await printToPrinter(lines, config);

    expect(result.ok).toBe(true);
    expect(printer.connectionCount()).toBe(1);
  });

  it("devuelve ok:false si la impresora acepta la conexión y la tira sin transferir nada", async () => {
    // Este es el bug crítico: la impresora acepta el TCP handshake y destruye
    // el socket de inmediato, sin leer nada — exactamente lo que hace una
    // impresora que corta la conexión tras aceptarla. Contra el código viejo
    // (execute() de node-thermal-printer, fire-and-forget) esto devolvía
    // ok:true con 0 bytes recibidos, 5/5 veces. Con la entrega por socket
    // propio, un error/cierre prematuro durante la escritura debe producir
    // ok:false. Usamos `failAllConnections()` (no `failNextConnection()`)
    // porque `printToPrinter` reintenta hasta MAX_TRIES veces con un socket
    // fresco cada vez — un fallo de un solo intento por sí solo NO debe
    // traducirse en un `ok:false` final si un reintento posterior conecta
    // bien (ver la prueba de reintento, más abajo); aquí queremos probar el
    // caso en el que la impresora tira TODAS las conexiones.
    printer = await startFakePrinter();
    printer.failAllConnections();
    const config = configFor(printer);

    const result = await printToPrinter(lines, config);

    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(printer.received().length).toBe(0);
  }, 10000);

  it("un reintento usa un socket fresco: falla la primera conexión, imprime en la segunda, una sola vez", async () => {
    printer = await startFakePrinter();
    printer.failNextConnection();
    const config = configFor(printer);

    const result = await printToPrinter(lines, config);

    expect(result.ok).toBe(true);
    // Dos conexiones entrantes: la primera destruida (el intento fallido),
    // la segunda la que realmente imprime.
    expect(printer.connectionCount()).toBe(2);
    await waitFor(() => printer.received().includes(Buffer.from("COCINA", "latin1")));
    expect(printer.received().includes(Buffer.from("COCINA", "latin1"))).toBe(true);
    // Solo una impresión: el texto no aparece duplicado.
    const occurrences = printer.received().toString("latin1").split("COCINA").length - 1;
    expect(occurrences).toBe(1);
  }, 10000);
});
