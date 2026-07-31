import { describe, expect, it, vi } from "vitest";
import { makeUsbSink, type WinspoolBinding } from "./usb-sink-winspool.js";

function fakeBinding(overrides: Partial<WinspoolBinding> = {}): WinspoolBinding & {
  calls: { openedWith: string[]; wrote: Buffer[]; closed: number };
} {
  const calls = { openedWith: [] as string[], wrote: [] as Buffer[], closed: 0 };
  const base: WinspoolBinding = {
    openPrinter: (name) => {
      calls.openedWith.push(name);
      return { handle: name };
    },
    writeRawDoc: (_h, _doc, buf) => {
      calls.wrote.push(buf);
      return buf.length; // todos los bytes por defecto
    },
    closePrinter: () => {
      calls.closed += 1;
    },
    ...overrides,
  };
  return Object.assign(base, { calls });
}

const buffer = Buffer.from([0x1b, 0x40, 0x41]); // ESC @ A

describe("makeUsbSink", () => {
  it("abre la impresora por nombre, escribe el buffer exacto y cierra", async () => {
    const b = fakeBinding();
    const sink = makeUsbSink(b);
    await sink(buffer, "EPSON TM-T20");
    expect(b.calls.openedWith).toEqual(["EPSON TM-T20"]);
    expect(b.calls.wrote).toHaveLength(1);
    expect(b.calls.wrote[0]?.equals(buffer)).toBe(true);
    expect(b.calls.closed).toBe(1);
  });

  it("lanza (y cierra igual) si se escriben menos bytes de los pedidos", async () => {
    const b = fakeBinding({ writeRawDoc: (_h, _d, buf) => buf.length - 1 });
    const sink = makeUsbSink(b);
    await expect(sink(buffer, "P")).rejects.toThrow(/bytes/i);
    expect(b.calls.closed).toBe(1); // cerró pese al fallo
  });

  it("si openPrinter lanza, propaga y no intenta cerrar un handle inexistente", async () => {
    const b = fakeBinding({
      openPrinter: () => {
        throw new Error("no existe la impresora");
      },
    });
    const sink = makeUsbSink(b);
    await expect(sink(buffer, "NOPE")).rejects.toThrow(/impresora/i);
    expect(b.calls.closed).toBe(0);
  });
});

/**
 * La carga del binding nativo tiene que ocurrir UNA vez por proceso. No es una optimización:
 * `koffi.struct` registra el tipo en una tabla global y la segunda llamada lanza
 * `Duplicate type name`. Con dos consumidores (imprimir prueba y arrancar el agente) eso se
 * manifestaba como un emparejamiento que fallaba con un mensaje que no hablaba de impresoras.
 */
describe("loadWinspoolBinding", () => {
  it("carga una sola vez aunque se pida muchas veces, y desde varios sitios a la vez", async () => {
    let structsRegistrados = 0;
    vi.doMock("koffi", () => ({
      default: {
        load: () => ({ func: () => () => 0 }),
        struct: (nombre: string) => {
          structsRegistrados += 1;
          // Igual que koffi de verdad: el registro es global y no admite repetidos.
          if (structsRegistrados > 1) throw new Error(`Duplicate type name '${nombre}'`);
          return {};
        },
        as: (valor: unknown) => valor,
      },
    }));

    const { loadWinspoolBinding } = await import("./usb-sink-winspool.js");

    // En paralelo, que es el caso que una caché del RESULTADO (y no de la promesa) no cubre.
    const [a, b] = await Promise.all([loadWinspoolBinding(), loadWinspoolBinding()]);
    const c = await loadWinspoolBinding();

    expect(structsRegistrados).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
