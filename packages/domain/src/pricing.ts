import type { Cents } from "./money.js";

export type PricedLine = {
  unitPrice: Cents;
  quantity: number;
  extras: Cents[];
  /**
   * Tipo de IVA de ESTA línea, en tanto por uno (0.10 = 10 %).
   *
   * Va en la línea y no en el pedido porque un ticket español mezcla tipos a diario: el menú
   * tributa al 10 %, la botella que te llevas al 21 % y algunos alimentos al 4 %. Un tipo único
   * por ticket factura mal en cuanto el bar vende algo de tienda.
   */
  taxRate: number;
};

export type OrderTotals = {
  subtotal: Cents;
  taxAmount: Cents;
  total: Cents;
};

/** Base y cuota de UN tipo impositivo. Es el desglose que debe figurar en la factura. */
export type TaxBucket = {
  taxRate: number;
  base: Cents;
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
export function lineTotal(line: Omit<PricedLine, "taxRate">): Cents {
  assertIntegerAmount(line.unitPrice, "unitPrice");
  assertIntegerAmount(line.quantity, "quantity");
  line.extras.forEach((extra, index) => {
    assertIntegerAmount(extra, `extras[${index}]`);
  });

  const extrasPerUnit = line.extras.reduce((sum, extra) => sum + extra, 0);
  return (line.unitPrice + extrasPerUnit) * line.quantity;
}

/**
 * DESGLOSE POR TIPO IMPOSITIVO, que es como se declara una factura: no "la base del ticket", sino
 * la base de cada tipo por separado.
 *
 * Los precios de carta llevan el IVA incluido (norma española), así que el total de cada grupo es
 * la suma de sus líneas y la base se obtiene DIVIDIENDO por (1 + tipo). Calcularlo al revés
 * inflaría la cuenta.
 *
 * Se agrupa ANTES de redondear, y no línea a línea, a propósito: redondear cada línea y sumar
 * acumula céntimos de desviación contra lo que declara Hacienda, que trabaja por tipo. La cuota
 * se deriva restando la base al total del grupo, nunca redondeando aparte, así que
 * `base + cuota == total` se cumple exacto en cada grupo y por tanto en la suma.
 *
 * El tipo solo se valida aquí como última defensa matemática, no de negocio: este paquete no sabe
 * qué tipos existen en España (eso lo decide quien llama). Lo único que necesita garantizar es
 * que `1 + taxRate` no sea cero ni negativo -- si lo fuera, la base saldría `Infinity` o cambiaría
 * de signo. Los grupos salen ordenados por tipo, para que el ticket no baile entre impresiones.
 */
export function taxBreakdown(lines: PricedLine[]): TaxBucket[] {
  const porTipo = new Map<number, Cents>();
  for (const line of lines) {
    const { taxRate } = line;
    if (!Number.isFinite(taxRate) || taxRate <= -1) {
      throw new Error(`taxRate debe ser finito y mayor que -1: ${taxRate}`);
    }
    porTipo.set(taxRate, (porTipo.get(taxRate) ?? 0) + lineTotal(line));
  }

  return [...porTipo.entries()]
    .sort(([a], [b]) => a - b)
    .map(([taxRate, total]) => {
      const base = Math.round(total / (1 + taxRate));
      return { taxRate, base, taxAmount: total - base, total };
    });
}

/**
 * Totales del pedido, sumando el desglose por tipo. Un pedido vacío da todo a cero.
 *
 * Deriva de `taxBreakdown` para que la cabecera del ticket y su desglose no puedan discrepar:
 * si salieran de dos cálculos distintos, acabarían separándose por un céntimo tarde o temprano.
 */
export function computeTotals(lines: PricedLine[]): OrderTotals {
  return taxBreakdown(lines).reduce<OrderTotals>(
    (acc, bucket) => ({
      subtotal: acc.subtotal + bucket.base,
      taxAmount: acc.taxAmount + bucket.taxAmount,
      total: acc.total + bucket.total,
    }),
    { subtotal: 0, taxAmount: 0, total: 0 },
  );
}
