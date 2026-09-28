import { AVISO_NO_FACTURA, ETIQUETA_EMISOR, formatCents, idiomaDeRecibo } from "@suarex/domain";
import { sanitizeForThermal } from "./sanitize.js";
import type { ReceiptOrder, TicketBranding, TicketFiscal, TicketLine } from "./types.js";

// `Intl` separa la cifra del símbolo con un espacio duro o estrecho que la térmica no
// siempre imprime; se pliega cualquier espacio (incluidos esos) a uno normal. El € sí lo
// conserva el codepage PC858.
const HARD_SPACES = /\s/g;

/** Cómo se lee un tipo en el papel: 0.1 -> "10 %", 0.045 -> "4,5 %". Sin decimales cuando es
 *  redondo, que es lo normal, y con coma decimal porque el ticket es español. */
function porcentaje(taxRate: number): string {
  const pct = taxRate * 100;
  const texto = Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, "");
  return `${texto.replace(".", ",")} %`;
}

/**
 * Las líneas de base y cuota del recibo. Con desglose, una pareja por tipo -- que es lo que exige
 * una factura cuando el ticket mezcla tipos. Sin él (pedidos anteriores a que existiera), se cae
 * al total agregado de siempre, para no dejar recibos antiguos sin base ni IVA.
 */
function desgloseImpositivo(order: ReceiptOrder, money: (cents: number) => string): TicketLine[] {
  const buckets = order.taxBreakdown ?? [];
  if (buckets.length === 0) {
    return [
      { kind: "row", left: "Base", right: money(order.subtotalCents) },
      { kind: "row", left: "IVA", right: money(order.taxCents) },
    ];
  }
  return buckets.flatMap((bucket): TicketLine[] => [
    { kind: "row", left: `Base ${porcentaje(bucket.taxRate)}`, right: money(bucket.baseCents) },
    { kind: "row", left: `IVA ${porcentaje(bucket.taxRate)}`, right: money(bucket.taxCents) },
  ]);
}

function formatHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

/**
 * EL RECIBO DEL CLIENTE, que sale por la impresora del propio totem al aprobar el cobro.
 *
 * A diferencia de la comanda (que agrupa por destino y no lleva dinero), el recibo lo lleva TODO:
 * las líneas con su precio, la base, el IVA, el total y el código de recogida -- el MISMO que el
 * comensal acaba de ver en la pantalla del totem. Los importes vienen ya calculados por el
 * servidor (`ReceiptOrder`), nunca de la carta.
 *
 * Los pares etiqueta/precio van como `row`: el driver los alinea al ancho real del papel, así que
 * el mismo recibo cuadra en 58 y en 80 mm sin fijar columnas a mano.
 */
export function buildReceiptLines(
  order: ReceiptOrder,
  branding: TicketBranding,
  fiscal: TicketFiscal = {},
): TicketLine[] {
  const money = (cents: number) =>
    formatCents(cents, order.locale, order.currency).replace(HARD_SPACES, " ");
  // El aviso cae a español ante un locale desconocido: mejor en el idioma que no toca que
  // ausente, que es justo lo que D1 quería evitar.
  const idioma = idiomaDeRecibo(order.locale);

  const lines: TicketLine[] = [
    {
      kind: "text",
      text: sanitizeForThermal(branding.header),
      align: "center",
      bold: true,
      size: 2,
    },
    { kind: "divider" },
    { kind: "text", text: "RECIBO", align: "center", bold: true },
    order.tableLabel
      ? { kind: "text", text: `MESA ${order.tableLabel}`, align: "left", bold: true }
      : { kind: "text", text: "PARA LLEVAR", align: "left", bold: true },
    { kind: "text", text: `Hora: ${formatHHMM(order.createdAt)}`, align: "left" },
    { kind: "divider" },
  ];

  for (const item of order.items) {
    lines.push({
      kind: "row",
      left: `${item.quantity}x ${sanitizeForThermal(item.name)}`,
      right: money(item.lineCents),
    });
    for (const extra of item.extras) {
      lines.push({ kind: "text", text: `   + ${sanitizeForThermal(extra)}`, align: "left" });
    }
  }

  lines.push(
    { kind: "divider" },
    ...desgloseImpositivo(order, money),
    { kind: "row", left: "TOTAL", right: money(order.totalCents), bold: true },
    { kind: "divider" },
    // El código que el comensal vio en pantalla: con esto recoge su pedido.
    { kind: "text", text: "RECOGIDA", align: "center", bold: true },
    {
      kind: "text",
      text: sanitizeForThermal(order.pickupCode),
      align: "center",
      bold: true,
      size: 2,
    },
    { kind: "text", text: `Pedido #${order.orderNumber}`, align: "center" },
  );

  // BLOQUE FISCAL, al final y no antes del código de recogida: lo que el comensal necesita de
  // un vistazo es su código, no el CIF. Y siempre ANTES del corte -- después no se imprimiría.
  const emisor = [fiscal.legalName, fiscal.cif, fiscal.address, fiscal.phone]
    .map((x) => x?.trim())
    .filter((x): x is string => Boolean(x));
  if (emisor.length > 0) {
    lines.push({ kind: "divider" });
    lines.push({
      kind: "text",
      text: sanitizeForThermal(`${ETIQUETA_EMISOR[idioma]}: ${emisor.join(" · ")}`),
      align: "center",
    });
  }

  // El aviso NO es opcional y no depende de que el tenant haya configurado nada: es lo único
  // que separa un justificante de pedido de un documento que lo parece (decisión D1, Fase 1).
  lines.push({
    kind: "text",
    text: sanitizeForThermal(AVISO_NO_FACTURA[idioma]),
    align: "center",
  });

  lines.push({ kind: "newline" }, { kind: "cut" });

  return lines;
}
