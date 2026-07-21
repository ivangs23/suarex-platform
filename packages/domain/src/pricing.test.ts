import { describe, expect, it } from "vitest";
import { computeTotals, lineTotal } from "./pricing.js";

describe("lineTotal", () => {
  it("multiplica precio por cantidad", () => {
    expect(lineTotal({ unitPrice: 450, quantity: 3, extras: [] })).toBe(1350);
  });

  it("suma los extras a cada unidad", () => {
    expect(lineTotal({ unitPrice: 450, quantity: 2, extras: [150, 50] })).toBe(1300);
  });
});

describe("computeTotals", () => {
  it("trata el precio de carta como IVA incluido", () => {
    // 11,00 € con IVA del 10 %: base 10,00 €, cuota 1,00 €.
    const totals = computeTotals([{ unitPrice: 1100, quantity: 1, extras: [] }], 0.1);
    expect(totals.total).toBe(1100);
    expect(totals.subtotal).toBe(1000);
    expect(totals.taxAmount).toBe(100);
  });

  it("el desglose siempre suma exactamente el total", () => {
    // 4,50 € al 10 % no divide exacto; el redondeo no puede perder ni inventar céntimos.
    const totals = computeTotals([{ unitPrice: 450, quantity: 1, extras: [] }], 0.1);
    expect(totals.subtotal + totals.taxAmount).toBe(totals.total);
  });

  it("suma varias líneas", () => {
    const totals = computeTotals(
      [
        { unitPrice: 1800, quantity: 1, extras: [] },
        { unitPrice: 450, quantity: 2, extras: [150] },
      ],
      0.1,
    );
    expect(totals.total).toBe(1800 + 1200);
  });

  it("con tipo cero, la cuota es cero y la base es el total", () => {
    const totals = computeTotals([{ unitPrice: 1000, quantity: 1, extras: [] }], 0);
    expect(totals).toEqual({ subtotal: 1000, taxAmount: 0, total: 1000 });
  });

  it("un pedido vacío da todo a cero", () => {
    expect(computeTotals([], 0.1)).toEqual({ subtotal: 0, taxAmount: 0, total: 0 });
  });
});
