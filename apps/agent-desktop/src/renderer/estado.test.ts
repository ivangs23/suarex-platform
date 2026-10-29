import { describe, expect, it } from "vitest";
import { INITIAL_ACTIVITY } from "../main/agent-activity.js";
import {
  type AgentStatus,
  estadoGeneral,
  GRACIA_SIN_CONEXION_MS,
  resumenDeImpresion,
} from "./estado.js";

const AHORA = Date.parse("2026-10-29T21:00:00Z");

const imprimiendo: AgentStatus = {
  paired: true,
  running: true,
  deviceId: "dev-1",
  platform: "win32",
  activity: { ...INITIAL_ACTIVITY, lastTickAt: "2026-10-29T20:59:58Z", printedTotal: 42 },
};

const caida = (destination: string, printerId = `p-${destination}`) => ({
  printerId,
  destination,
  reason: "ECONNREFUSED",
});

describe("estadoGeneral", () => {
  it("imprimiendo, sin nada roto: ok", () => {
    expect(estadoGeneral(imprimiendo, AHORA, null)).toMatchObject({
      nivel: "ok",
      etiqueta: "Imprimiendo",
      titulo: "Imprimiendo pedidos",
    });
  });

  it("una impresora caída NO es «imprimiendo»: aviso, con su destino y a dónde ir", () => {
    // El fallo que originó este módulo: la cabecera decía «Imprimiendo pedidos» en verde.
    const e = estadoGeneral(
      { ...imprimiendo, activity: { ...imprimiendo.activity, downPrinters: [caida("cocina")] } },
      AHORA,
      null,
    );
    expect(e).toMatchObject({
      nivel: "aviso",
      titulo: "La impresora de cocina no responde",
      accion: { seccion: "impresoras" },
    });
    expect(e.detalle).toMatch(/no se pierden/);
  });

  it("varias impresoras caídas se nombran juntas, sin repetir destino", () => {
    const e = estadoGeneral(
      {
        ...imprimiendo,
        activity: {
          ...imprimiendo.activity,
          downPrinters: [caida("cocina", "a"), caida("barra", "b"), caida("cocina", "c")],
        },
      },
      AHORA,
      null,
    );
    expect(e.titulo).toBe("Las impresoras de cocina y barra no responden");
  });

  it("un corte de red breve no se anuncia; pasado el margen, sí, y tapa a las impresoras", () => {
    const sinRed: AgentStatus = {
      ...imprimiendo,
      activity: {
        ...imprimiendo.activity,
        lastError: "fetch failed",
        downPrinters: [caida("barra")],
      },
    };
    const reciente = AHORA - (GRACIA_SIN_CONEXION_MS - 1);
    expect(estadoGeneral(sinRed, AHORA, reciente).nivel).toBe("aviso");
    expect(estadoGeneral(sinRed, AHORA, AHORA - GRACIA_SIN_CONEXION_MS)).toMatchObject({
      nivel: "error",
      etiqueta: "Sin conexión",
    });
  });

  it("conectando al arrancar: aviso que dice que no hay que hacer nada", () => {
    const e = estadoGeneral({ ...imprimiendo, running: false, conectando: true }, AHORA, null);
    expect(e).toMatchObject({ nivel: "aviso", etiqueta: "Conectando" });
    expect(e.detalle).toMatch(/No hace falta/);
  });

  it("vinculado pero parado (sesión perdida): error, y la acción lleva a volver a vincular", () => {
    expect(estadoGeneral({ ...imprimiendo, running: false }, AHORA, null)).toMatchObject({
      nivel: "error",
      accion: { seccion: "ajustes" },
    });
  });

  it("sin vincular: neutro, sin alarma", () => {
    expect(
      estadoGeneral({ ...imprimiendo, paired: false, running: false, deviceId: null }, AHORA, null),
    ).toMatchObject({ nivel: "neutro", etiqueta: "Sin vincular" });
  });

  it("una instalación incompleta tapa todo lo demás", () => {
    const e = estadoGeneral({ ...imprimiendo, configFaltante: ["SUPABASE_URL"] }, AHORA, null);
    expect(e).toMatchObject({ nivel: "error", etiqueta: "Instalación incompleta" });
  });
});

describe("resumenDeImpresion", () => {
  it("cuenta los tickets desde que arrancó la app", () => {
    const texto = resumenDeImpresion({ ...imprimiendo, startedAt: "2026-10-29T18:00:00Z" });
    expect(texto).toMatch(/^42 tickets impresos desde las \d{2}:\d{2}\.$/);
  });

  it("singular, e incidencias si las hay", () => {
    const texto = resumenDeImpresion({
      ...imprimiendo,
      activity: { ...imprimiendo.activity, printedTotal: 1, failedTotal: 2 },
    });
    expect(texto).toBe("1 ticket impreso, 2 con incidencias.");
  });

  it("sin tickets aún, lo dice sin ceros", () => {
    expect(resumenDeImpresion({ ...imprimiendo, activity: INITIAL_ACTIVITY })).toBe(
      "Ningún ticket impreso.",
    );
  });
});
