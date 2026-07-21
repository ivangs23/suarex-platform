import type { Cents } from "./money.js";

export type PricedLine = {
  unitPrice: Cents;
  quantity: number;
  extras: Cents[];
};

export type OrderTotals = {
  subtotal: Cents;
  taxAmount: Cents;
  total: Cents;
};

export function lineTotal(line: PricedLine): Cents {
  const extrasPerUnit = line.extras.reduce((sum, extra) => sum + extra, 0);
  return (line.unitPrice + extrasPerUnit) * line.quantity;
}

/**
 * Los precios de carta llevan el IVA incluido (norma española), así que el total
 * es la suma de las líneas y la base imponible se obtiene DIVIDIENDO por (1 + tipo).
 * Calcularlo al revés inflaría la cuenta un 10 %.
 *
 * La cuota se deriva restando la base al total, no redondeando por separado: así
 * base + cuota == total siempre, sin céntimos perdidos ni inventados.
 */
export function computeTotals(lines: PricedLine[], taxRate: number): OrderTotals {
  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const subtotal = Math.round(total / (1 + taxRate));
  return { subtotal, taxAmount: total - subtotal, total };
}
