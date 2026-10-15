import { describe, expect, it } from "vitest";
import {
  arrancarConReintentos,
  type DepsArranque,
  esperaAntesDeReintentar,
} from "./arranque-con-reintentos.js";

class FalloDeRed extends Error {}
class SesionRevocada extends Error {}

/** Un arranque de mentira que falla con los errores dados, en orden, y luego funciona. */
function escenario(errores: Error[], opciones: { seguir?: () => boolean } = {}) {
  const pendientes = [...errores];
  const registro: string[] = [];
  const esperas: number[] = [];
  const estados: boolean[] = [];
  let intentos = 0;
  const deps: DepsArranque = {
    arrancar: async () => {
      intentos += 1;
      const e = pendientes.shift();
      if (e) throw e;
    },
    esSinConexion: (e) => e instanceof FalloDeRed,
    esperar: async (ms) => {
      esperas.push(ms);
    },
    seguir: opciones.seguir ?? (() => true),
    alCambiarConectando: (c) => estados.push(c),
    avisos: {
      sinConexion: () => registro.push("sin-conexion"),
      recuperado: (n) => registro.push(`recuperado tras ${n}`),
      sesionInvalida: () => registro.push("sesion-invalida"),
    },
  };
  return { deps, registro, esperas, estados, intentos: () => intentos };
}

describe("arrancarConReintentos", () => {
  it("con red arranca a la primera, sin esperar ni avisar de nada", async () => {
    const e = escenario([]);
    expect(await arrancarConReintentos(e.deps)).toBe("arrancado");
    expect(e.esperas).toEqual([]);
    expect(e.registro).toEqual([]);
    expect(e.estados).toEqual([true, false]);
  });

  it("sin red reintenta solo hasta que vuelve, y entonces arranca", async () => {
    // El caso real: un PC que arranca antes de que conecte la wifi.
    const e = escenario([new FalloDeRed(), new FalloDeRed(), new FalloDeRed(), new FalloDeRed()]);

    expect(await arrancarConReintentos(e.deps)).toBe("arrancado");
    expect(e.intentos()).toBe(5);
    expect(e.esperas).toEqual([5_000, 10_000, 30_000, 60_000]);
    // Un aviso al empezar y otro al recuperarse, no uno por intento: un corte de horas no puede
    // llenar el registro que luego se manda en el diagnóstico.
    expect(e.registro).toEqual(["sin-conexion", "recuperado tras 4"]);
    // "Conectando" durante toda la espera, una sola vez, y se quita al arrancar.
    expect(e.estados).toEqual([true, false]);
  });

  it("una sesión que ya no vale no se reintenta: pide re-emparejar", async () => {
    // Reintentar no arregla un token revocado, y además ocultaría que hay que hacer algo.
    const e = escenario([new SesionRevocada()]);

    expect(await arrancarConReintentos(e.deps)).toBe("sesion-invalida");
    expect(e.intentos()).toBe(1);
    expect(e.esperas).toEqual([]);
    expect(e.registro).toEqual(["sesion-invalida"]);
    expect(e.estados).toEqual([true, false]);
  });

  it("si la red vuelve pero la sesión resulta no valer, también para", async () => {
    const e = escenario([new FalloDeRed(), new SesionRevocada()]);

    expect(await arrancarConReintentos(e.deps)).toBe("sesion-invalida");
    expect(e.registro).toEqual(["sin-conexion", "sesion-invalida"]);
    expect(e.estados).toEqual([true, false]);
  });

  it("deja de reintentar si ya no tiene sentido (des-emparejado, re-emparejado o cerrando)", async () => {
    let vueltas = 0;
    const e = escenario([new FalloDeRed(), new FalloDeRed(), new FalloDeRed()], {
      seguir: () => {
        vueltas += 1;
        return vueltas <= 2;
      },
    });

    expect(await arrancarConReintentos(e.deps)).toBe("abandonado");
    expect(e.intentos()).toBe(2);
    expect(e.estados).toEqual([true, false]);
  });

  it("si ya no tiene sentido antes de empezar, ni lo intenta", async () => {
    const e = escenario([], { seguir: () => false });

    expect(await arrancarConReintentos(e.deps)).toBe("abandonado");
    expect(e.intentos()).toBe(0);
    expect(e.estados).toEqual([]);
  });
});

describe("esperaAntesDeReintentar", () => {
  it("empieza rápido y se queda en un minuto", () => {
    expect([1, 2, 3, 4, 5, 50].map(esperaAntesDeReintentar)).toEqual([
      5_000, 10_000, 30_000, 60_000, 60_000, 60_000,
    ]);
  });
});
