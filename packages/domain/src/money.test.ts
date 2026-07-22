import { describe, expect, it } from "vitest";
import { centsToEuros, eurosToCents, formatCents } from "./money.js";

describe("eurosToCents", () => {
  it("convierte sin errores de coma flotante", () => {
    // 4.35 * 100 da 434.99999... en coma flotante; redondear es obligatorio.
    expect(eurosToCents(4.35)).toBe(435);
    expect(eurosToCents(19.99)).toBe(1999);
    expect(eurosToCents(0)).toBe(0);
  });

  it("rechaza valores no finitos o negativos", () => {
    expect(() => eurosToCents(Number.NaN)).toThrow();
    expect(() => eurosToCents(-1)).toThrow();
  });

  it("normaliza -0 a 0 en vez de conservar el signo", () => {
    const cents = eurosToCents(-0);
    expect(cents).toBe(0);
    expect(Object.is(cents, -0)).toBe(false);
  });
});

describe("centsToEuros", () => {
  it("invierte la conversión", () => {
    expect(centsToEuros(435)).toBe(4.35);
  });

  it("normaliza -0 a 0 en vez de conservar el signo", () => {
    const euros = centsToEuros(-0);
    expect(euros).toBe(0);
    expect(Object.is(euros, -0)).toBe(false);
  });
});

// Intl.NumberFormat separa el importe del símbolo con un espacio de no
// ruptura (U+00A0), no un espacio normal (U+0020).
const NBSP = " ";

describe("formatCents", () => {
  it("formatea céntimos como divisa localizada", () => {
    expect(formatCents(1999, "es-ES", "EUR")).toBe(`19,99${NBSP}€`);
  });

  it("formatea cero sin signo negativo", () => {
    expect(formatCents(0, "es-ES", "EUR")).toBe(`0,00${NBSP}€`);
  });

  it("formatea eurosToCents(-0) sin signo negativo (regresión)", () => {
    expect(formatCents(eurosToCents(-0), "es-ES", "EUR")).toBe(`0,00${NBSP}€`);
  });

  it("lanza RangeError con un código de divisa inválido", () => {
    expect(() => formatCents(100, "es-ES", "XXXX")).toThrow(RangeError);
  });
});
