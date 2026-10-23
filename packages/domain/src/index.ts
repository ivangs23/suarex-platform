export type { ChannelTotal, DailySummary, SummaryLine, SummaryOrder } from "./daily-summary.js";
export { summarizeDay } from "./daily-summary.js";
export { diaEnZona, horaEnZona, limitesDelDia } from "./dia-de-negocio.js";
export {
  MAX_CANTIDAD_LINEA,
  MAX_EXTRAS_LINEA,
  MAX_LINEAS_PEDIDO,
  MAX_NOTAS_LINEA,
} from "./limites-pedido.js";
export type { Cents } from "./money.js";
export { centsToEuros, cobroCuadraConPedido, eurosToCents, formatCents } from "./money.js";
export type { OptionGroup, OptionViolation } from "./option-groups.js";
export { isSelectionComplete, validateOptionGroups } from "./option-groups.js";
export { pickupCodeFromToken } from "./pickup.js";
export type { OrderTotals, PricedLine, TaxBucket } from "./pricing.js";
export { computeTotals, lineTotal, taxBreakdown } from "./pricing.js";
export type { IdiomaRecibo } from "./recibo.js";
export { AVISO_NO_FACTURA, ETIQUETA_EMISOR, idiomaDeRecibo } from "./recibo.js";
