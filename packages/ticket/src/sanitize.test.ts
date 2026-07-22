import { describe, expect, it } from "vitest";
import { sanitizeForThermal } from "./sanitize.js";

describe("sanitizeForThermal", () => {
  it("quita los acentos", () => {
    expect(sanitizeForThermal("Jamón")).toBe("Jamon");
    expect(sanitizeForThermal("café con leche")).toBe("cafe con leche");
  });
  it("conserva la eñe como n", () => {
    expect(sanitizeForThermal("Niño")).toBe("Nino");
  });
  it("pliega comillas tipográficas y guiones a ASCII", () => {
    expect(sanitizeForThermal("“hola”—ya")).toBe('"hola"-ya');
  });
  it("reemplaza un emoji por interrogante", () => {
    expect(sanitizeForThermal("pizza 🍕")).toBe("pizza ?");
  });
  it("deja el euro intacto (codepage 858 lo tiene)", () => {
    expect(sanitizeForThermal("3,50 €")).toBe("3,50 €");
  });
});
