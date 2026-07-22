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

describe("printToPrinter (escpos-tcp)", () => {
  it("entrega los bytes a la impresora", async () => {
    printer = await startFakePrinter();
    const config: PrinterConfig = {
      id: "p1",
      label: "Cocina",
      destination: "cocina",
      adapter: "escpos-tcp",
      host: "127.0.0.1",
      port: printer.port,
    };

    const result = await printToPrinter(lines, config);

    expect(result.ok).toBe(true);
    expect(printer.received().includes(Buffer.from("COCINA", "latin1"))).toBe(true);
    expect(printer.received().includes(Buffer.from("Tosta", "latin1"))).toBe(true);
  });

  it("devuelve ok:false si la impresora no está", async () => {
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
    const config: PrinterConfig = {
      id: "p1",
      label: "Cocina",
      destination: "cocina",
      adapter: "escpos-tcp",
      host: "127.0.0.1",
      port: printer.port,
    };

    const result = await printToPrinter(lines, config);

    expect(result.ok).toBe(true);
    expect(printer.connectionCount()).toBe(1);
  });
});
