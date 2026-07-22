import { afterEach, describe, expect, it } from "vitest";
import type { PrinterConfig } from "./adapters/types.js";
import { deviceKey, printToPrinter } from "./print-order.js";
import { renderEscPos } from "./render.js";
import { registerUsbRawSink } from "./usb-sink.js";

const lines = [
  { kind: "text" as const, text: "COCINA", align: "center" as const, bold: true },
  { kind: "text" as const, text: "1x  Tosta", align: "left" as const },
  { kind: "cut" as const },
];

const usbConfig: PrinterConfig = {
  adapter: "escpos-usb",
  id: "p1",
  label: "Cocina",
  destination: "cocina",
  printerName: "EPSON TM-T20",
};

afterEach(() => {
  registerUsbRawSink(null); // restaura el default entre tests
});

describe("printToPrinter (escpos-usb)", () => {
  it("entrega al sink el Buffer exacto de renderEscPos, para el printerName correcto", async () => {
    const received: { buffer: Buffer; printerName: string }[] = [];
    registerUsbRawSink(async (buffer, printerName) => {
      received.push({ buffer, printerName });
    });

    const result = await printToPrinter(lines, usbConfig);

    expect(result.ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]?.printerName).toBe("EPSON TM-T20");
    expect(received[0]?.buffer.equals(renderEscPos(lines))).toBe(true);
  });

  it("un sink que lanza produce ok:false con reason", async () => {
    registerUsbRawSink(async () => {
      throw new Error("spooler no disponible");
    });
    const result = await printToPrinter(lines, usbConfig);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("sin sink registrado, el default falla limpio (ok:false)", async () => {
    // registerUsbRawSink no se llamó (el afterEach del test anterior lo restauró a default).
    const result = await printToPrinter(lines, usbConfig);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("deviceKey de una config USB usa el esquema usb::", () => {
    expect(deviceKey(usbConfig)).toBe("usb::EPSON TM-T20");
  });

  it("deviceKey de una config TCP sigue usando tcp::", () => {
    const tcp: PrinterConfig = {
      adapter: "escpos-tcp",
      id: "p2",
      label: "Red",
      destination: "cocina",
      host: "127.0.0.1",
      port: 9100,
    };
    expect(deviceKey(tcp)).toBe("tcp::127.0.0.1:9100");
  });
});
