import { describe, expect, it } from "vitest";
import { filtrarAgotados } from "./agotado.js";

const AHORA = new Date("2026-10-23T13:00:00Z");

describe("filtrarAgotados", () => {
  it("deja los que nunca se marcaron", () => {
    expect(filtrarAgotados([{ id: "a", unavailableUntil: null }], AHORA)).toHaveLength(1);
  });

  it("oculta el agotado hasta su hora de vuelta", () => {
    const pulpo = { id: "pulpo", unavailableUntil: "2026-10-24T04:00:00Z" };
    expect(filtrarAgotados([pulpo], AHORA)).toEqual([]);
  });

  it("a su hora vuelve solo, sin que nadie lo reponga", () => {
    const pulpo = { id: "pulpo", unavailableUntil: "2026-10-24T04:00:00Z" };
    expect(filtrarAgotados([pulpo], new Date("2026-10-24T04:00:00Z"))).toEqual([pulpo]);
  });
});
