import { describe, expect, it } from "vitest";
import type { SummaryOrder } from "./daily-summary.js";
import { summarizeDay } from "./daily-summary.js";
import { taxBreakdown } from "./pricing.js";

/**
 * Esto se mira con la calculadora al lado y se pasa a la contabilidad, así que lo que se prueba
 * es que los números CUADREN -- entre sí y con lo que se imprimió en los tickets.
 */

/** Un pedido de una línea, con su tipo. Los precios son IVA incluido, como se cobran. */
const pedido = (channel: string, ...lineas: [number, number][]): SummaryOrder => ({
  channel,
  totalCents: lineas.reduce((suma, [cents]) => suma + cents, 0),
  lines: lineas.map(([lineCents, taxRate]) => ({ lineCents, taxRate })),
});

describe("summarizeDay", () => {
  it("un día sin pedidos da todo a cero, no revienta", () => {
    expect(summarizeDay([])).toEqual({
      orderCount: 0,
      totalCents: 0,
      byChannel: [],
      taxByRate: [],
    });
  });

  it("cuenta los pedidos y suma lo cobrado", () => {
    const resumen = summarizeDay([pedido("qr-mesa", [1100, 0.1]), pedido("kiosko", [2200, 0.1])]);
    expect(resumen.orderCount).toBe(2);
    expect(resumen.totalCents).toBe(3300);
  });

  it("separa por canal, del que más entra al que menos", () => {
    const resumen = summarizeDay([
      pedido("qr-mesa", [1000, 0.1]),
      pedido("kiosko", [5000, 0.1]),
      pedido("qr-mesa", [1000, 0.1]),
    ]);
    expect(resumen.byChannel).toEqual([
      { channel: "kiosko", orderCount: 1, totalCents: 5000 },
      { channel: "qr-mesa", orderCount: 2, totalCents: 2000 },
    ]);
  });

  it("desglosa el IVA por tipo, que es lo que pide la contabilidad", () => {
    // El día típico: menús al 10 % y una botella para llevar al 21 %.
    const resumen = summarizeDay([pedido("qr-mesa", [1100, 0.1], [1210, 0.21])]);
    expect(resumen.taxByRate).toEqual([
      { taxRate: 0.1, baseCents: 1000, taxCents: 100, totalCents: 1100 },
      { taxRate: 0.21, baseCents: 1000, taxCents: 210, totalCents: 1210 },
    ]);
  });

  it("el desglose suma exactamente lo cobrado", () => {
    const resumen = summarizeDay([
      pedido("qr-mesa", [333, 0.1], [333, 0.1]),
      pedido("kiosko", [1999, 0.21], [450, 0.04]),
    ]);
    const sumaDesglose = resumen.taxByRate.reduce((s, t) => s + t.totalCents, 0);
    expect(sumaDesglose).toBe(resumen.totalCents);

    // Y cada tipo cuadra por dentro: base + cuota = total.
    for (const tipo of resumen.taxByRate) {
      expect(tipo.baseCents + tipo.taxCents).toBe(tipo.totalCents);
    }
  });

  it("redondea sobre el total del día, no sumando el redondeo de cada ticket", () => {
    /* Es la diferencia entre cuadrar y no cuadrar. Tres tickets de 3,33 € al 10 %: redondeando
       uno a uno la base sale 303+303+303 = 909; sobre el agregado, 999/1,1 = 908. Un céntimo que
       en un día de doscientos tickets se convierte en decenas que no casan con nada. */
    const resumen = summarizeDay([
      pedido("qr-mesa", [333, 0.1]),
      pedido("qr-mesa", [333, 0.1]),
      pedido("qr-mesa", [333, 0.1]),
    ]);
    expect(resumen.taxByRate).toEqual([
      { taxRate: 0.1, baseCents: 908, taxCents: 91, totalCents: 999 },
    ]);
  });

  it("cuadra con lo que se imprimió: mismo cálculo que el recibo", () => {
    /* El desglose del cierre y el de los tickets salen de la MISMA función. Si el cierre hiciera
       su propia aritmética, un día diferiría de la suma de los recibos y no habría forma de saber
       cuál miente. */
    const lineas = [
      { unitPrice: 1234, quantity: 1, extras: [], taxRate: 0.1 },
      { unitPrice: 987, quantity: 1, extras: [], taxRate: 0.21 },
    ];
    const resumen = summarizeDay([pedido("qr-mesa", [1234, 0.1], [987, 0.21])]);

    expect(resumen.taxByRate.map((t) => [t.taxRate, t.baseCents, t.taxCents])).toEqual(
      taxBreakdown(lineas).map((b) => [b.taxRate, b.base, b.taxAmount]),
    );
  });

  it("un pedido sin líneas cuenta para el total pero no inventa IVA", () => {
    // Puede pasar con datos viejos o a medias: mejor que sume el cobro a que tumbe el cierre.
    const resumen = summarizeDay([{ channel: "qr-mesa", totalCents: 500, lines: [] }]);
    expect(resumen.orderCount).toBe(1);
    expect(resumen.totalCents).toBe(500);
    expect(resumen.taxByRate).toEqual([]);
  });
});
