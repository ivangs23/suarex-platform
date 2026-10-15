import { describe, expect, it } from "vitest";
import {
  esArranqueDesatendido,
  FLAG_SEGUNDO_PLANO,
  opcionesDeInicioConWindows,
} from "./arranque-desatendido.js";

describe("esArranqueDesatendido", () => {
  it("lo es si Windows lo lanzó con el flag", () => {
    expect(esArranqueDesatendido(["C:\\A\\SuarEx Agente.exe", FLAG_SEGUNDO_PLANO])).toBe(true);
  });

  it("no lo es si alguien abrió la app a mano: entonces sí se enseña la ventana", () => {
    expect(esArranqueDesatendido(["C:\\A\\SuarEx Agente.exe"])).toBe(false);
  });
});

describe("opcionesDeInicioConWindows", () => {
  it("arranca con Windows y con el flag, para quedarse en la bandeja", () => {
    const opciones = opcionesDeInicioConWindows();
    expect(opciones.openAtLogin).toBe(true);
    expect(esArranqueDesatendido(opciones.args)).toBe(true);
  });
});
