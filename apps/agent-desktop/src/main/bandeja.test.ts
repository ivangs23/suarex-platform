import { describe, expect, it, vi } from "vitest";
import { INITIAL_ACTIVITY } from "./agent-activity.js";
import { avisoDeCaida, avisoDeVuelta, menuDeBandeja, textoDeBandeja } from "./bandeja.js";
import type { EstadoGeneral } from "./estado.js";

const OK: EstadoGeneral = {
  nivel: "ok",
  etiqueta: "Imprimiendo",
  titulo: "Imprimiendo pedidos",
  detalle: "",
};
const CAIDA: EstadoGeneral = {
  nivel: "aviso",
  etiqueta: "Atención",
  titulo: "La impresora de cocina no responde",
  detalle: "",
};

describe("textoDeBandeja", () => {
  it("dice el mismo estado que la ventana, corto cuando todo va bien", () => {
    expect(textoDeBandeja(OK)).toBe("SuarEx: imprimiendo");
    expect(textoDeBandeja(CAIDA)).toBe("SuarEx: La impresora de cocina no responde");
  });

  it("no pasa de los 127 caracteres que admite Windows", () => {
    const largo = { ...CAIDA, titulo: "x".repeat(200) };
    expect(textoDeBandeja(largo)).toHaveLength(127);
  });
});

describe("menuDeBandeja", () => {
  const acciones = {
    abrir: vi.fn(),
    irA: vi.fn(),
    exportarDiagnostico: vi.fn(),
    salir: vi.fn(),
  };

  it("abre con el estado, que se lee pero no se pulsa", () => {
    const [primera] = menuDeBandeja(CAIDA, acciones);
    expect(primera).toEqual({
      label: "Atención: La impresora de cocina no responde",
      enabled: false,
    });
  });

  it("cada entrada hace lo suyo", () => {
    const menu = menuDeBandeja(OK, acciones);
    const pulsa = (label: string) =>
      (menu.find((m) => m.label === label)?.click as (() => void) | undefined)?.();
    pulsa("Comandas");
    pulsa("Impresoras");
    pulsa("Exportar diagnóstico…");
    expect(acciones.irA.mock.calls).toEqual([["pedidos"], ["impresoras"]]);
    expect(acciones.exportarDiagnostico).toHaveBeenCalledOnce();
    expect(menu.at(-1)?.label).toBe("Salir");
  });
});

describe("avisos", () => {
  const fallo = (printerId: string, destination: "cocina" | "barra") => ({
    printerId,
    orderNumber: null,
    destination,
    reason: "ECONNREFUSED",
  });

  it("una impresora caída se nombra por su destino y dice qué pasa con sus tickets", () => {
    expect(avisoDeCaida([fallo("p1", "cocina")])).toEqual({
      titulo: "La impresora de cocina no responde",
      cuerpo: expect.stringMatching(/no se pierden/),
    });
    expect(avisoDeCaida([fallo("p1", "cocina"), fallo("p2", "barra")])?.titulo).toBe(
      "Las impresoras de cocina y barra no responden",
    );
    expect(avisoDeCaida([])).toBeNull();
  });

  it("la que vuelve se nombra por el destino que tenía al caer", () => {
    const antes = {
      ...INITIAL_ACTIVITY,
      downPrinters: [{ printerId: "p1", destination: "barra", reason: "x" }],
    };
    expect(avisoDeVuelta(["p1"], antes)?.titulo).toBe("La impresora de barra vuelve a responder");
    expect(avisoDeVuelta([], antes)).toBeNull();
  });
});
