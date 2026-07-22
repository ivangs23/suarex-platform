import { describe, expect, it } from "vitest";
import { effectiveDestination } from "./routing.js";

describe("effectiveDestination", () => {
  it("respeta el destino explícito", () => {
    expect(
      effectiveDestination({ name: "Vino", quantity: 1, destination: "cocina", extras: [] }),
    ).toBe("cocina");
  });
  it("infiere barra por palabra clave cuando no hay destino", () => {
    expect(
      effectiveDestination({ name: "Copa de vino", quantity: 1, destination: null, extras: [] }),
    ).toBe("barra");
    expect(effectiveDestination({ name: "Caña", quantity: 1, destination: null, extras: [] })).toBe(
      "barra",
    );
  });
  it("cae en cocina por defecto", () => {
    expect(
      effectiveDestination({ name: "Tosta de jamón", quantity: 1, destination: null, extras: [] }),
    ).toBe("cocina");
  });
  it("ignora acentos al inferir", () => {
    expect(effectiveDestination({ name: "Café", quantity: 1, destination: null, extras: [] })).toBe(
      "barra",
    );
  });
});
