import { describe, expect, it } from "vitest";
import type { PricedLine } from "./pricing.js";
import { computeTotals, lineTotal, taxBreakdown } from "./pricing.js";

describe("lineTotal", () => {
  it("multiplica precio por cantidad", () => {
    expect(lineTotal({ unitPrice: 450, quantity: 3, extras: [] })).toBe(1350);
  });

  it("suma los extras a cada unidad", () => {
    expect(lineTotal({ unitPrice: 450, quantity: 2, extras: [150, 50] })).toBe(1300);
  });

  it("rechaza una quantity fraccionaria", () => {
    expect(() => lineTotal({ unitPrice: 433, quantity: 1.5, extras: [] })).toThrow(/quantity/);
  });

  it("rechaza un unitPrice fraccionario", () => {
    expect(() => lineTotal({ unitPrice: 433.5, quantity: 1, extras: [] })).toThrow(/unitPrice/);
  });

  it("rechaza un extra fraccionario", () => {
    expect(() => lineTotal({ unitPrice: 433, quantity: 1, extras: [150, 1.2] })).toThrow(
      /extras\[1\]/,
    );
  });

  it("permite quantity negativa (línea de devolución/anulación)", () => {
    expect(lineTotal({ unitPrice: 500, quantity: -1, extras: [] })).toBe(-500);
  });
});

describe("computeTotals", () => {
  it("trata el precio de carta como IVA incluido", () => {
    // 11,00 € con IVA del 10 %: base 10,00 €, cuota 1,00 €.
    const totals = computeTotals([{ unitPrice: 1100, quantity: 1, extras: [], taxRate: 0.1 }]);
    expect(totals.total).toBe(1100);
    expect(totals.subtotal).toBe(1000);
    expect(totals.taxAmount).toBe(100);
  });

  it("el desglose siempre suma exactamente el total", () => {
    // 4,50 € al 10 % no divide exacto; el redondeo no puede perder ni inventar céntimos.
    const totals = computeTotals([{ unitPrice: 450, quantity: 1, extras: [], taxRate: 0.1 }]);
    expect(totals.subtotal + totals.taxAmount).toBe(totals.total);
  });

  it("suma varias líneas", () => {
    const totals = computeTotals([
      { unitPrice: 1800, quantity: 1, extras: [], taxRate: 0.1 },
      { unitPrice: 450, quantity: 2, extras: [150], taxRate: 0.1 },
    ]);
    expect(totals.total).toBe(1800 + 1200);
  });

  it("con tipo cero, la cuota es cero y la base es el total", () => {
    const totals = computeTotals([{ unitPrice: 1000, quantity: 1, extras: [], taxRate: 0 }]);
    expect(totals).toEqual({ subtotal: 1000, taxAmount: 0, total: 1000 });
  });

  it("un pedido vacío da todo a cero", () => {
    expect(computeTotals([])).toEqual({ subtotal: 0, taxAmount: 0, total: 0 });
  });

  it("rechaza un taxRate no finito", () => {
    expect(() =>
      computeTotals([{ unitPrice: 1000, quantity: 1, extras: [], taxRate: Number.NaN }]),
    ).toThrow(/taxRate/);
    expect(() =>
      computeTotals([
        { unitPrice: 1000, quantity: 1, extras: [], taxRate: Number.POSITIVE_INFINITY },
      ]),
    ).toThrow(/taxRate/);
  });

  it("rechaza un taxRate <= -1 (haría la base infinita o de signo cambiado)", () => {
    expect(() =>
      computeTotals([{ unitPrice: 1000, quantity: 1, extras: [], taxRate: -1 }]),
    ).toThrow(/taxRate/);
    expect(() =>
      computeTotals([{ unitPrice: 1000, quantity: 1, extras: [], taxRate: -2 }]),
    ).toThrow(/taxRate/);
  });

  it("un taxRate de 1 (100 %) sigue siendo aritméticamente válido", () => {
    // Este paquete no juzga si un tipo es fiscalmente razonable, solo que la
    // división por (1 + taxRate) no rompa. Esa decisión de negocio vive en
    // quien llama (createPendingOrder en @suarex/db).
    const totals = computeTotals([{ unitPrice: 1000, quantity: 1, extras: [], taxRate: 1 }]);
    expect(totals.subtotal + totals.taxAmount).toBe(totals.total);
  });
});

/**
 * Barrido compacto del invariante subtotal + taxAmount === total.
 *
 * Un único caso hardcodeado solo protege frente a una regresión que rompa
 * justo esa combinación de importe y tipo. Estos casos están elegidos para
 * que una regresión típica (redondear taxAmount de forma independiente en
 * vez de derivarlo por resta) falle en al menos uno de ellos: un tipo alto,
 * un tipo cuya división no es exacta, un pedido con varias líneas, y un tipo
 * cero.
 */
describe("computeTotals — invariante subtotal + taxAmount === total (barrido)", () => {
  const cases: Array<{ name: string; lines: Omit<PricedLine, "taxRate">[]; taxRate: number }> = [
    {
      name: "tipo alto realista (IVA general 21 %)",
      lines: [{ unitPrice: 4999, quantity: 3, extras: [125] }],
      taxRate: 0.21,
    },
    {
      // total/(1+tipo) = 1002/(4/3) = 751.5: cae justo en un .5, que es donde
      // "redondear taxAmount por separado" y "restar" divergen.
      name: "tipo cuya división no termina (1/3)",
      lines: [{ unitPrice: 330, quantity: 3, extras: [4] }],
      taxRate: 1 / 3,
    },
    {
      name: "pedido con varias líneas, cantidades y extras distintos (IVA reducido 4 %)",
      lines: [
        { unitPrice: 500, quantity: 1, extras: [] },
        { unitPrice: 200, quantity: 2, extras: [] },
        { unitPrice: 205, quantity: 1, extras: [] },
      ],
      taxRate: 0.04,
    },
    {
      name: "tipo cero",
      lines: [{ unitPrice: 733, quantity: 4, extras: [1] }],
      taxRate: 0,
    },
    {
      // Caso límite explícito: con tipo 100 % y total impar, total/(1+tipo)
      // cae exactamente en .5 siempre. Máxima garantía de detectar un
      // redondeo independiente de taxAmount, sea cual sea el tipo real.
      name: "caso límite: total/(1+tipo) exactamente en .5 (tipo 100 %)",
      lines: [{ unitPrice: 1001, quantity: 1, extras: [] }],
      taxRate: 1,
    },
  ];

  it.each(cases)("$name", ({ lines, taxRate }) => {
    const totals = computeTotals(lines.map((line) => ({ ...line, taxRate })));
    expect(totals.subtotal + totals.taxAmount).toBe(totals.total);
    expect(Number.isInteger(totals.subtotal)).toBe(true);
    expect(Number.isInteger(totals.taxAmount)).toBe(true);
  });
});

describe("taxBreakdown — el desglose que exige una factura", () => {
  it("separa cada tipo con su base y su cuota, ordenados de menor a mayor", () => {
    // El caso español de diario: un menú al 10 % y una botella para llevar al 21 %.
    const buckets = taxBreakdown([
      { unitPrice: 1100, quantity: 1, extras: [], taxRate: 0.1 },
      { unitPrice: 1210, quantity: 1, extras: [], taxRate: 0.21 },
    ]);
    expect(buckets).toEqual([
      { taxRate: 0.1, base: 1000, taxAmount: 100, total: 1100 },
      { taxRate: 0.21, base: 1000, taxAmount: 210, total: 1210 },
    ]);
  });

  it("agrupa las líneas del mismo tipo en un solo renglón", () => {
    const buckets = taxBreakdown([
      { unitPrice: 500, quantity: 1, extras: [], taxRate: 0.1 },
      { unitPrice: 600, quantity: 1, extras: [], taxRate: 0.1 },
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.total).toBe(1100);
  });

  it("agrupa ANTES de redondear: el desglose cuadra con el total exacto", () => {
    /* Tres líneas de 3,33 € al 10 %. Redondeando línea a línea la base saldría 303+303+303=909;
       agrupando, 999/1,1 = 908,18 -> 908. Un céntimo de diferencia contra lo que se declara. */
    const buckets = taxBreakdown([
      { unitPrice: 333, quantity: 1, extras: [], taxRate: 0.1 },
      { unitPrice: 333, quantity: 1, extras: [], taxRate: 0.1 },
      { unitPrice: 333, quantity: 1, extras: [], taxRate: 0.1 },
    ]);
    expect(buckets[0]).toEqual({ taxRate: 0.1, base: 908, taxAmount: 91, total: 999 });
  });

  it("cada grupo cuadra por separado y la suma cuadra con los totales", () => {
    const lines = [
      { unitPrice: 1234, quantity: 3, extras: [55], taxRate: 0.1 },
      { unitPrice: 987, quantity: 2, extras: [], taxRate: 0.21 },
      { unitPrice: 250, quantity: 1, extras: [], taxRate: 0.04 },
    ];
    const buckets = taxBreakdown(lines);
    for (const bucket of buckets) {
      expect(bucket.base + bucket.taxAmount).toBe(bucket.total);
    }
    const totals = computeTotals(lines);
    expect(buckets.reduce((s, b) => s + b.total, 0)).toBe(totals.total);
    expect(buckets.reduce((s, b) => s + b.base, 0)).toBe(totals.subtotal);
    expect(totals.subtotal + totals.taxAmount).toBe(totals.total);
  });

  it("un pedido vacío no tiene desglose", () => {
    expect(taxBreakdown([])).toEqual([]);
  });
});
