import type { OrderReceipt } from "@suarex/db";
import type { Strings } from "@/lib/i18n";

/**
 * RECIBO EN PDF, descargable. El botón hacía `window.print()`, que en el móvil del comensal a
 * menudo no abre nada; un PDF que se descarga funciona en cualquier dispositivo, se guarda y se
 * imprime luego si hace falta. El PDF se arma en el navegador (jsPDF, importado solo al pulsar
 * para no cargar la librería a quien no descarga) a partir de los MISMOS datos congelados que
 * pinta el recibo en pantalla.
 *
 * La composición (`filasRecibo`) es pura: no toca jsPDF ni el DOM, así se prueba sin navegador.
 */

/** Una fila del recibo, ya resuelta a texto. El render solo la coloca; no decide nada. */
export type FilaRecibo =
  | { tipo: "centro"; texto: string; negrita?: boolean; tam?: number }
  | { tipo: "partida"; izq: string; der: string; negrita?: boolean; tam?: number }
  | { tipo: "detalle"; texto: string } // extra o nota, sangrado y en gris
  | { tipo: "regla" }
  | { tipo: "hueco" };

export function nombreArchivoRecibo(orderNumber: number): string {
  return `recibo-${orderNumber}.pdf`;
}

/**
 * Compone las filas del recibo. `formatearDinero` y `fecha` llegan ya resueltos por quien llama
 * (con el locale y la moneda del pedido), para que esta función no dependa de Intl ni del reloj.
 */
export function filasRecibo(
  receipt: OrderReceipt,
  opts: {
    businessName: string;
    fecha: string;
    strings: Strings;
    formatearDinero: (cents: number) => string;
  },
): FilaRecibo[] {
  const { businessName, fecha, strings: t, formatearDinero } = opts;
  const filas: FilaRecibo[] = [];
  // El nombre del negocio encabeza el recibo; si no se conoce, no se inventa una línea vacía.
  if (businessName?.trim()) {
    filas.push({ tipo: "centro", texto: businessName.trim(), negrita: true, tam: 15 });
  }
  filas.push({ tipo: "centro", texto: t.receiptTitle, tam: 11 });

  const cabecera = [
    `${t.orderTitle} #${receipt.orderNumber}`,
    receipt.tableLabel ? `${t.receiptTable} ${receipt.tableLabel}` : null,
    fecha,
  ]
    .filter(Boolean)
    .join("   ·   ");
  filas.push({ tipo: "centro", texto: cabecera, tam: 9 });
  filas.push({ tipo: "regla" });

  for (const line of receipt.lines) {
    filas.push({
      tipo: "partida",
      izq: `${line.quantity}× ${line.name}`,
      der: formatearDinero(line.lineTotalCents),
    });
    for (const extra of line.extras) filas.push({ tipo: "detalle", texto: extra.name });
    if (line.notes) filas.push({ tipo: "detalle", texto: `“${line.notes}”` });
  }

  filas.push({ tipo: "regla" });
  filas.push({
    tipo: "partida",
    izq: t.total,
    der: formatearDinero(receipt.totalCents),
    negrita: true,
    tam: 12,
  });

  return filas;
}

const ANCHO_MM = 80;
const MARGEN = 6;
const ANCHO_UTIL = ANCHO_MM - MARGEN * 2;
const avance = (tam: number) => tam * 0.42 + 1.6; // mm por línea, aprox. para el tamaño en pt

/**
 * Recorre las filas sobre `doc`. Con `medir=true` no pinta nada, solo devuelve el alto (mm) que
 * ocuparía: sirve para dimensionar la página al contenido antes de crearla (un ticket no lleva
 * un A4 de aire debajo). Con `medir=false` dibuja y el alto devuelto se ignora.
 */
function recorrer(doc: import("jspdf").jsPDF, filas: FilaRecibo[], medir: boolean): number {
  let y = MARGEN;
  for (const fila of filas) {
    if (fila.tipo === "hueco") {
      y += 3;
      continue;
    }
    if (fila.tipo === "regla") {
      if (!medir) {
        doc.setDrawColor(180);
        doc.line(MARGEN, y, ANCHO_MM - MARGEN, y);
      }
      y += 3;
      continue;
    }
    if (fila.tipo === "centro") {
      const tam = fila.tam ?? 10;
      doc.setFont("helvetica", fila.negrita ? "bold" : "normal");
      doc.setFontSize(tam);
      doc.setTextColor(20);
      for (const l of doc.splitTextToSize(fila.texto, ANCHO_UTIL)) {
        if (!medir) doc.text(l, ANCHO_MM / 2, y, { align: "center" });
        y += avance(tam);
      }
      continue;
    }
    if (fila.tipo === "detalle") {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(120);
      for (const l of doc.splitTextToSize(fila.texto, ANCHO_UTIL - 4)) {
        if (!medir) doc.text(l, MARGEN + 4, y);
        y += avance(8);
      }
      doc.setTextColor(20);
      continue;
    }
    // partida: texto a la izquierda (con envoltorio), precio a la derecha en la primera línea.
    const tam = fila.tam ?? 9.5;
    doc.setFont("helvetica", fila.negrita ? "bold" : "normal");
    doc.setFontSize(tam);
    doc.setTextColor(20);
    const anchoDer = doc.getTextWidth(fila.der);
    const lineasIzq: string[] = doc.splitTextToSize(fila.izq, ANCHO_UTIL - anchoDer - 2);
    lineasIzq.forEach((l, i) => {
      if (!medir) {
        doc.text(l, MARGEN, y);
        if (i === 0) doc.text(fila.der, ANCHO_MM - MARGEN, y, { align: "right" });
      }
      y += avance(tam);
    });
  }
  return y + MARGEN;
}

/**
 * Arma el PDF y lo descarga. Importa jsPDF de forma perezosa: quien solo mira el recibo no paga
 * el coste de la librería. Página estrecha (80 mm), como un ticket, con el alto ajustado al
 * contenido en dos pasadas (medir, luego dibujar sobre la página ya dimensionada).
 */
export async function descargarReciboPdf(
  receipt: OrderReceipt,
  opts: {
    businessName: string;
    fecha: string;
    strings: Strings;
    formatearDinero: (cents: number) => string;
  },
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const filas = filasRecibo(receipt, opts);

  const regla = new jsPDF({ orientation: "portrait", unit: "mm", format: [ANCHO_MM, 600] });
  // El alto se ajusta al contenido, pero nunca por debajo del ancho: en `portrait` jsPDF
  // intercambia los lados si el ancho supera al alto, y entonces la página saldría más estrecha
  // de 80 mm y cortaría los precios (alineados al borde derecho). Con `alto >= ANCHO_MM` no hay
  // intercambio y el ancho se mantiene en 80 mm.
  const alto = Math.max(ANCHO_MM, recorrer(regla, filas, true));

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [ANCHO_MM, alto] });
  recorrer(doc, filas, false);
  doc.save(nombreArchivoRecibo(receipt.orderNumber));
}
