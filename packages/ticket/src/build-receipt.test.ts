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
