import { describe, expect, it, vi } from "vitest";
import type { PrinterConfig } from "./adapters/types.js";
import { aggregateStatus, createPrinterHealth } from "./health.js";
import { enqueueByDevice } from "./queue.js";

function red(id: string, host: string, port = 9100): PrinterConfig {
  return { id, label: id, destination: "recibo", adapter: "escpos-tcp", host, port };
}

const usb: PrinterConfig = {
  id: "u1",
  label: "USB",
  destination: "recibo",
  adapter: "escpos-usb",
  printerName: "TM-T20",
};

describe("createPrinterHealth", () => {
  it("sin evidencia, no inventa: dice que no sabe", () => {
    const health = createPrinterHealth();
    expect(health.read(red("p1", "10.0.0.1"))).toEqual({ status: "unknown" });
  });

  it("una entrega correcta deja la impresora en ok", () => {
    const health = createPrinterHealth({ now: () => 1000 });
    health.record(red("p1", "10.0.0.1"), { ok: true });
    expect(health.read(red("p1", "10.0.0.1"))).toEqual({ status: "ok", checkedAt: 1000 });
  });

  it("una entrega fallida deja la impresora caída, con su motivo", () => {
    const health = createPrinterHealth({ now: () => 1000 });
    health.record(red("p1", "10.0.0.1"), { ok: false, reason: "ECONNREFUSED" });
    expect(health.read(red("p1", "10.0.0.1"))).toEqual({
      status: "down",
      reason: "ECONNREFUSED",
      checkedAt: 1000,
    });
  });

  it("la evidencia caduca: pasado el plazo vuelve a ser desconocida", () => {
    let ahora = 1000;
    const health = createPrinterHealth({ now: () => ahora, staleAfterMs: 5000 });
    health.record(red("p1", "10.0.0.1"), { ok: true });

    ahora = 5999;
    expect(health.read(red("p1", "10.0.0.1")).status).toBe("ok");

    ahora = 6001;
    expect(health.read(red("p1", "10.0.0.1"))).toEqual({ status: "unknown" });
  });

  it("el estado va por DISPOSITIVO: dos configs al mismo host:puerto comparten evidencia", () => {
    const health = createPrinterHealth({ now: () => 1000 });
    health.record(red("cocina", "10.0.0.1"), { ok: false, reason: "sin papel" });
    // Otra fila en la base, el mismo aparato físico.
    expect(health.read(red("barra", "10.0.0.1")).status).toBe("down");
    // Un aparato distinto no se contagia.
    expect(health.read(red("otra", "10.0.0.2"))).toEqual({ status: "unknown" });
  });

  it("refresh sondea las de red y guarda el resultado", async () => {
    const probe = vi.fn(async (config: PrinterConfig) =>
      config.adapter === "escpos-tcp" && config.host === "10.0.0.1"
        ? { ok: true }
        : { ok: false, reason: "apagada" },
    );
    const health = createPrinterHealth({ probe, now: () => 1000 });

    await health.refresh([red("p1", "10.0.0.1"), red("p2", "10.0.0.2")]);

    expect(health.read(red("p1", "10.0.0.1")).status).toBe("ok");
    expect(health.read(red("p2", "10.0.0.2"))).toEqual({
      status: "down",
      reason: "apagada",
      checkedAt: 1000,
    });
  });

  it("refresh NO sondea las USB: winspool no se puede preguntar sin gastar papel", async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const health = createPrinterHealth({ probe });

    await health.refresh([usb]);

    expect(probe).not.toHaveBeenCalled();
    expect(health.read(usb)).toEqual({ status: "unknown" });
  });

  it("una USB SÍ se conoce por sus entregas, que es la única evidencia que da", () => {
    const health = createPrinterHealth({ now: () => 1000 });
    health.record(usb, { ok: true });
    expect(health.read(usb).status).toBe("ok");
  });

  it("sondea una sola vez un dispositivo que aparece en varias configs", async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const health = createPrinterHealth({ probe });

    await health.refresh([red("cocina", "10.0.0.1"), red("barra", "10.0.0.1")]);

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("no vuelve a sondear una impresora que acaba de imprimir bien", async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const health = createPrinterHealth({ probe, now: () => 1000, trustOkMs: 5000 });
    health.record(red("p1", "10.0.0.1"), { ok: true });

    await health.refresh([red("p1", "10.0.0.1")]);

    expect(probe).not.toHaveBeenCalled();
  });

  it("pasada la ventana de confianza vuelve a mirar, aunque el ok siga sin caducar", async () => {
    // Lo que se sabe sigue contando (`staleAfterMs` amplio), pero se vuelve a comprobar: una
    // impresora que se apaga justo tras el último ticket no puede tardar minuto y medio en verse.
    let ahora = 1000;
    const probe = vi.fn(async () => ({ ok: false, reason: "apagada" }));
    const health = createPrinterHealth({
      probe,
      now: () => ahora,
      staleAfterMs: 90_000,
      trustOkMs: 5000,
    });
    health.record(red("p1", "10.0.0.1"), { ok: true });

    ahora = 7000;
    await health.refresh([red("p1", "10.0.0.1")]);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(health.read(red("p1", "10.0.0.1")).status).toBe("down");
  });

  it("una impresora CAÍDA sí se re-sondea: recuperarse se nota al latido siguiente", async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const health = createPrinterHealth({ probe, now: () => 1000 });
    health.record(red("p1", "10.0.0.1"), { ok: false, reason: "apagada" });

    await health.refresh([red("p1", "10.0.0.1")]);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(health.read(red("p1", "10.0.0.1")).status).toBe("ok");
  });

  it("una sonda que revienta deja la impresora caída, no tumba el refresh entero", async () => {
    const probe = vi.fn(async (config: PrinterConfig) => {
      if (config.id === "p1") throw new Error("boom");
      return { ok: true };
    });
    const health = createPrinterHealth({ probe, now: () => 1000 });

    await expect(
      health.refresh([red("p1", "10.0.0.1"), red("p2", "10.0.0.2")]),
    ).resolves.toBeUndefined();

    expect(health.read(red("p1", "10.0.0.1"))).toEqual({
      status: "down",
      reason: "boom",
      checkedAt: 1000,
    });
    expect(health.read(red("p2", "10.0.0.2")).status).toBe("ok");
  });

  it("la sonda espera su turno: no compite con un ticket en vuelo en el mismo dispositivo", async () => {
    const orden: string[] = [];
    let liberaImpresion: (() => void) | undefined;
    const impresionEnVuelo = new Promise<void>((resolve) => {
      liberaImpresion = resolve;
    });

    const printer = red("p1", "10.0.0.1");
    // Simula la entrega real: ocupa la cola de ESE dispositivo, igual que `printToPrinter`.
    const impresion = enqueueByDevice("tcp::10.0.0.1:9100", async () => {
      orden.push("imprime:empieza");
      await impresionEnVuelo;
      orden.push("imprime:termina");
    });

    const health = createPrinterHealth({
      probe: async () => {
        orden.push("sonda");
        return { ok: true };
      },
    });
    const refresco = health.refresh([printer]);

    liberaImpresion?.();
    await Promise.all([impresion, refresco]);

    expect(orden).toEqual(["imprime:empieza", "imprime:termina", "sonda"]);
  });
});

describe("aggregateStatus", () => {
  it("sin impresoras en el grupo, no hay avería: es desconocido", () => {
    expect(aggregateStatus([])).toEqual({ status: "unknown" });
  });

  it("una viva basta: el papel sale, aunque la de repuesto no conteste", () => {
    expect(
      aggregateStatus([
        { status: "down", reason: "apagada", checkedAt: 2000 },
        { status: "ok", checkedAt: 1000 },
      ]),
    ).toEqual({ status: "ok", checkedAt: 1000 });
  });

  it("todas caídas: devuelve la evidencia más reciente", () => {
    expect(
      aggregateStatus([
        { status: "down", reason: "vieja", checkedAt: 1000 },
        { status: "down", reason: "reciente", checkedAt: 3000 },
      ]),
    ).toEqual({ status: "down", reason: "reciente", checkedAt: 3000 });
  });

  it("solo desconocidas sigue siendo desconocido, nunca caída", () => {
    expect(aggregateStatus([{ status: "unknown" }, { status: "unknown" }])).toEqual({
      status: "unknown",
    });
  });

  it("una caída y otra desconocida cuenta como caída: hay evidencia de avería", () => {
    expect(
      aggregateStatus([{ status: "unknown" }, { status: "down", reason: "x", checkedAt: 5 }]),
    ).toEqual({ status: "down", reason: "x", checkedAt: 5 });
  });
});
