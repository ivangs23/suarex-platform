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

function assertIntegerAmount(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} debe ser un entero: ${value}`);
  }
}

/**
 * `unitPrice`, `quantity` y cada `extras[i]` deben ser enteros: son céntimos
 * (o un contador de unidades), y una cantidad fraccionaria como 1.5 haría que
 * `total` dejase de ser un entero, violando "todo el dinero son céntimos
 * enteros" sin que ningún tipo lo impida (`quantity: number` acepta 1.5 igual
 * que 1).
 *
 * `quantity` negativa SÍ está permitida deliberadamente: representa una línea
 * de devolución o anulación en un POS (p. ej. "-1 x Menú del día" para
 * corregir un pedido ya cobrado). Nada en el dominio produce hoy una
 * cantidad negativa, pero nada la prohíbe tampoco: el invariante
 * `subtotal + taxAmount === total` se cumple igual con cantidades negativas
 * (es aritmética lineal), y negarla ahora solo para tener que revertirlo
 * cuando se modele el primer reembolso sería más coste que beneficio. Lo que
 * no se permite es que sea fraccionaria.
 */
export function lineTotal(line: PricedLine): Cents {
  assertIntegerAmount(line.unitPrice, "unitPrice");
  assertIntegerAmount(line.quantity, "quantity");
  line.extras.forEach((extra, index) => {
    assertIntegerAmount(extra, `extras[${index}]`);
  });

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
 *
 * `taxRate` solo se valida aquí como última línea de defensa matemática, no de
 * negocio: este paquete no sabe qué es un tipo de IVA razonable (eso lo decide
 * quien llama, p. ej. `createPendingOrder` en `@suarex/db`). Lo único que esta
 * función necesita garantizar es que `1 + taxRate` no sea cero ni negativo --
 * si lo fuera, la base saldría `Infinity` o cambiaría de signo. Por eso el
 * límite es `taxRate > -1` y no algo más estrecho: un tipo de 1 (100 %) sigue
 * siendo válido aritméticamente (ver el caso límite en pricing.test.ts) aunque
 * no tenga sentido fiscal en España.
 */
export function computeTotals(lines: PricedLine[], taxRate: number): OrderTotals {
  if (!Number.isFinite(taxRate) || taxRate <= -1) {
    throw new Error(`taxRate debe ser finito y mayor que -1: ${taxRate}`);
  }

  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const subtotal = Math.round(total / (1 + taxRate));
  return { subtotal, taxAmount: total - subtotal, total };
}
