import { describe, expect, it } from "vitest";
import { pickFromRegistry } from "./pick";

// Registro falso: lo que se prueba es la RESOLUCIÓN (qué entrada gana y cuándo cae al
// fallback), no los componentes en sí -- de ahí que no haga falta importar los `.tsx`.
const registry = { generic: "GENERIC", garum: "GARUM", manuela: "MANUELA" };

describe("pickFromRegistry (resolución de tema)", () => {
  it("devuelve el tema a medida de un slug registrado", () => {
    expect(pickFromRegistry(registry, "garum", "generic")).toBe("GARUM");
    expect(pickFromRegistry(registry, "manuela", "generic")).toBe("MANUELA");
  });

  it("devuelve el genérico cuando el slug es el genérico", () => {
    expect(pickFromRegistry(registry, "generic", "generic")).toBe("GENERIC");
  });

  it("un slug desconocido cae al fallback (nunca deja la carta en blanco)", () => {
    expect(pickFromRegistry(registry, "no-existe", "generic")).toBe("GENERIC");
  });

  it("un tema ausente, nulo o vacío cae al fallback", () => {
    expect(pickFromRegistry(registry, null, "generic")).toBe("GENERIC");
    expect(pickFromRegistry(registry, undefined, "generic")).toBe("GENERIC");
    expect(pickFromRegistry(registry, "", "generic")).toBe("GENERIC");
  });
});
