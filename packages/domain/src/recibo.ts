/**
 * EL AVISO DE QUE UN RECIBO NO ES UNA FACTURA.
 *
 * Decisión D1 del spec de la Fase 1: SuarEx no emite facturas. Este aviso es lo único que
 * separa un justificante de pedido de un documento que lo parece, así que va en TODAS las
 * superficies donde el comensal recibe un recibo con desglose de IVA -- pantalla, PDF y el
 * papel que sale por la impresora del totem.
 *
 * Vive aquí, en `@suarex/domain`, y no en las cadenas de la web, porque el papel lo compone
 * `@suarex/ticket` desde el agente: sin un sitio común habría dos copias del mismo texto legal
 * y acabarían divergiendo. `apps/web/lib/i18n.ts` lo referencia en vez de repetirlo.
 *
 * El papel del totem es además la superficie que MÁS lo necesita: es la única que el comensal
 * se lleva físicamente, y la única de la que no tiene versión digital.
 */
export const AVISO_NO_FACTURA = {
  es: "Justificante de pedido. No válido como factura. Si necesitas factura, pídela al establecimiento.",
  en: "Order receipt. Not valid as an invoice. Ask the venue if you need a tax invoice.",
  pt: "Comprovativo de pedido. Não válido como fatura. Peça a fatura ao estabelecimento.",
} as const;

/** "Emitido por", la etiqueta del emisor. Mismo motivo que el aviso: se pinta en las tres. */
export const ETIQUETA_EMISOR = {
  es: "Emitido por",
  en: "Issued by",
  pt: "Emitido por",
} as const;

export type IdiomaRecibo = keyof typeof AVISO_NO_FACTURA;

/** Cae a español ante un locale desconocido: el aviso tiene que salir SIEMPRE, aunque sea en
 *  el idioma que no toca. Un recibo sin él es justo lo que D1 quería evitar. */
export function idiomaDeRecibo(locale: string | undefined): IdiomaRecibo {
  const corto = (locale ?? "es").slice(0, 2).toLowerCase();
  return corto === "en" || corto === "pt" ? corto : "es";
}
