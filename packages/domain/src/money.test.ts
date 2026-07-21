import { describe, expect, it } from "vitest";
import { centsToEuros, eurosToCents } from "./money.js";

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
});

describe("centsToEuros", () => {
  it("invierte la conversión", () => {
    expect(centsToEuros(435)).toBe(4.35);
  });
});
