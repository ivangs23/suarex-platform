import type { Cents } from "./money.js";
import { taxBreakdown } from "./pricing.js";

/**
 * EL RESUMEN DEL DÍA, para cuadrar la caja.
 *
 * Lo que el dueño necesita al cerrar: cuánto ha entrado, por dónde, y cuánto de eso es IVA de
 * cada tipo. Nada de métricas ni gráficas -- esto se mira con la calculadora al lado y se pasa a
 * la contabilidad.
 *
 * Es PURO: recibe los pedidos ya leídos y devuelve los totales. El desglose de IVA se calcula con
 * la MISMA función que imprime el recibo (`taxBreakdown`), y eso no es una comodidad: si el cierre
 * hiciera su propia aritmética, un día cuadraría distinto que la suma de los tickets y no habría
 * forma de saber cuál de los dos miente.
 */

/** Una línea de un pedido del día, tal como hace falta para sumar. */
export type SummaryLine = {
  /** Total de la línea en céntimos, IVA incluido (como se cobró). */
  lineCents: Cents;
  taxRate: number;
};

export type SummaryOrder = {
  channel: string;
  totalCents: Cents;
  lines: SummaryLine[];
};

export type ChannelTotal = {
  channel: string;
  orderCount: number;
  totalCents: Cents;
};

export type DailySummary = {
  orderCount: number;
  /** Lo cobrado en total, IVA incluido. */
  totalCents: Cents;
  /** Por canal, de mayor a menor: es el orden en que se mira. */
  byChannel: ChannelTotal[];
  /** Base y cuota por tipo de IVA, que es lo que pide la contabilidad. */
  taxByRate: { taxRate: number; baseCents: Cents; taxCents: Cents; totalCents: Cents }[];
};

/**
 * Suma los pedidos de un día.
 *
 * El desglose de IVA se calcula sobre TODAS las líneas juntas, no sumando el de cada ticket. Es
 * deliberado y es lo correcto fiscalmente: el redondeo se aplica una vez sobre la base agregada
 * de cada tipo, que es como se declara. Sumar los redondeos de doscientos tickets acumula
 * céntimos que no cuadran con nada.
 */
export function summarizeDay(orders: SummaryOrder[]): DailySummary {
  const porCanal = new Map<string, ChannelTotal>();
  const todasLasLineas: { unitPrice: Cents; quantity: number; extras: Cents[]; taxRate: number }[] =
    [];

  for (const order of orders) {
    const actual = porCanal.get(order.channel) ?? {
      channel: order.channel,
      orderCount: 0,
      totalCents: 0,
    };
    actual.orderCount += 1;
    actual.totalCents += order.totalCents;
    porCanal.set(order.channel, actual);

    for (const line of order.lines) {
      // Cada línea entra ya con su total: se envuelve para reutilizar `taxBreakdown` tal cual.
      todasLasLineas.push({
        unitPrice: line.lineCents,
        quantity: 1,
        extras: [],
        taxRate: line.taxRate,
      });
    }
  }

  return {
    orderCount: orders.length,
    totalCents: orders.reduce((suma, order) => suma + order.totalCents, 0),
    byChannel: [...porCanal.values()].sort((a, b) => b.totalCents - a.totalCents),
    taxByRate: taxBreakdown(todasLasLineas).map((bucket) => ({
      taxRate: bucket.taxRate,
      baseCents: bucket.base,
      taxCents: bucket.taxAmount,
      totalCents: bucket.total,
    })),
  };
}
