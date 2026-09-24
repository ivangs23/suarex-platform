import { describe, expect, it } from "vitest";
import { buildReceiptLines } from "./build-receipt.js";
import type { ReceiptOrder, TicketLine } from "./types.js";

const base: ReceiptOrder = {
  orderNumber: 42,
  tableLabel: "12",
  createdAt: "2026-07-22T10:30:00.000Z",
  items: [
    { name: "Ribera del Duero", quantity: 2, extras: ["Copa extra"], lineCents: 4200 },
    { name: "Tosta de jamón", quantity: 1, extras: [], lineCents: 1200 },
  ],
  subtotalCents: 4909,
  taxCents: 491,
  totalCents: 5400,
  currency: "EUR",
  locale: "es-ES",
  pickupCode: "A1B2C3",
};
const branding = { header: "Garum Vinoteca" };

/** Texto plano de las líneas de texto, para aserciones legibles. */
function texts(lines: TicketLine[]): string[] {
  return lines.flatMap((l) => (l.kind === "text" ? [l.text] : []));
}
/** Pares etiqueta/importe de las filas a dos columnas. */
function rows(lines: TicketLine[]): [string, string][] {
  return lines.flatMap((l) => (l.kind === "row" ? [[l.left, l.right] as [string, string]] : []));
}

describe("buildReceiptLines", () => {
  it("usa el header del tenant, no un literal", () => {
    const header = buildReceiptLines(base, branding).find(
      (l) => l.kind === "text" && l.bold && l.size === 2 && l.text === "Garum Vinoteca",
    );
    expect(header).toBeDefined();
  });

  it("cada línea lleva su precio a la derecha, y las extras debajo", () => {
    const lines = buildReceiptLines(base, branding);
    const r = rows(lines);
    expect(r).toContainEqual(["2x Ribera del Duero", "42,00 €"]);
    expect(r).toContainEqual(["1x Tosta de jamon", "12,00 €"]);
    // La extra aparece como sub-línea de texto, saneada.
    expect(texts(lines).some((t) => t.includes("+ Copa extra"))).toBe(true);
  });

  it("desglosa base, IVA y total; el total en negrita", () => {
    const lines = buildReceiptLines(base, branding);
    expect(rows(lines)).toContainEqual(["Base", "49,09 €"]);
    expect(rows(lines)).toContainEqual(["IVA", "4,91 €"]);
    const total = lines.find((l) => l.kind === "row" && l.left === "TOTAL");
    expect(total).toEqual({ kind: "row", left: "TOTAL", right: "54,00 €", bold: true });
  });

  it("enseña el código de recogida que vio el comensal, en grande", () => {
    const lines = buildReceiptLines(base, branding);
    const pickup = lines.find((l) => l.kind === "text" && l.size === 2 && l.text === "A1B2C3");
    expect(pickup).toBeDefined();
  });

  it("para llevar: sin mesa, pone PARA LLEVAR", () => {
    const lines = buildReceiptLines({ ...base, tableLabel: null }, branding);
    expect(texts(lines)).toContain("PARA LLEVAR");
    expect(texts(lines).some((t) => t.startsWith("MESA"))).toBe(false);
  });

  it("en mesa: pone MESA con su número", () => {
    expect(texts(buildReceiptLines(base, branding))).toContain("MESA 12");
  });

  it("termina en corte", () => {
    expect(buildReceiptLines(base, branding).at(-1)?.kind).toBe("cut");
  });
});

/**
 * EL BLOQUE FISCAL DEL PAPEL.
 *
 * Decisión D1 de la Fase 1: el recibo es un justificante, no una factura, y el aviso que lo
 * dice va en TODAS las superficies. El papel del totem se quedó fuera porque no existía cuando
 * se escribió aquello -- y es la que más lo necesita: lleva desglose de IVA, es la única que el
 * comensal se lleva físicamente y la única de la que no hay versión digital.
 */
describe("bloque fiscal del recibo", () => {
  const fiscal = {
    legalName: "Garum Hostelería SL",
    cif: "B12345678",
    address: "Calle Mayor 1, Madrid",
    phone: "910000000",
  };

  // Las aserciones van SIN acentos: `sanitizeForThermal` los quita porque el codepage de la
  // impresora térmica no los imprime. Es el texto que sale en papel, no el canónico.
  it("el aviso de que NO es una factura sale siempre, aun sin datos fiscales", () => {
    // Un tenant recién dado de alta no tiene CIF todavía, y el recibo tiene que seguir
    // saliendo -- pero el aviso no es opcional: es lo único que separa un justificante de un
    // documento que lo parece.
    const sinDatos = texts(buildReceiptLines(base, branding)).join(" ");
    expect(sinDatos).toContain("No valido como factura");

    const conDatos = texts(buildReceiptLines(base, branding, fiscal)).join(" ");
    expect(conDatos).toContain("No valido como factura");
  });

  it("el aviso sigue el idioma del pedido", () => {
    const en = texts(buildReceiptLines({ ...base, locale: "en-GB" }, branding)).join(" ");
    expect(en).toContain("Not valid as an invoice");
    const pt = texts(buildReceiptLines({ ...base, locale: "pt-PT" }, branding)).join(" ");
    expect(pt).toContain("Nao valido como fatura");
  });

  it("un locale desconocido cae a español en vez de quedarse sin aviso", () => {
    const raro = texts(buildReceiptLines({ ...base, locale: "de-DE" }, branding)).join(" ");
    expect(raro).toContain("No valido como factura");
  });

  it("imprime el emisor cuando el tenant lo tiene configurado", () => {
    // `branding.header` es el nombre comercial: sirve para reconocer el ticket, no para
    // identificar a quien cobra. Un papel con desglose de IVA y sin emisor se parece más a una
    // factura que la pantalla que la Fase 1 cuidó.
    const salida = texts(buildReceiptLines(base, branding, fiscal)).join(" ");
    expect(salida).toContain("Garum Hosteleria SL");
    expect(salida).toContain("B12345678");
    expect(salida).toContain("Calle Mayor 1, Madrid");
  });

  it("sin datos fiscales no imprime una línea de emisor vacía", () => {
    const salida = texts(buildReceiptLines(base, branding, {}));
    expect(salida.some((t) => t.trim() === "Emitido por:")).toBe(false);
    expect(salida.some((t) => t.includes("undefined"))).toBe(false);
  });

  it("el código de recogida sigue siendo lo más visible", () => {
    // El bloque fiscal va al FINAL a propósito: lo que el comensal necesita de un vistazo es su
    // código, no el CIF. Empujarlo hacia abajo cambiaría el recibo a peor.
    const lines = buildReceiptLines(base, branding, fiscal);
    const iRecogida = lines.findIndex((l) => l.kind === "text" && l.text === "RECOGIDA");
    const iEmisor = lines.findIndex((l) => l.kind === "text" && l.text.includes("B12345678"));
    expect(iRecogida).toBeGreaterThan(-1);
    expect(iEmisor).toBeGreaterThan(iRecogida);
  });

  it("el corte del papel sigue siendo la última línea", () => {
    // Si el bloque fiscal quedara DESPUÉS del corte, no saldría impreso.
    const lines = buildReceiptLines(base, branding, fiscal);
    expect(lines[lines.length - 1]?.kind).toBe("cut");
  });
});
