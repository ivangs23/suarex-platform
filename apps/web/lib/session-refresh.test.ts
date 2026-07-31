import { describe, expect, it } from "vitest";
import { MARGEN_MS, necesitaRefresco } from "./session-refresh";

const AHORA = Date.parse("2026-07-31T12:00:00.000Z");
/** `Session.expires_at` viene en segundos, no en milisegundos. */
const dentroDe = (ms: number) => (AHORA + ms) / 1000;

describe("necesitaRefresco", () => {
  it("no toca la red con un token recién emitido", () => {
    // El caso normal: token de una hora, petición a los dos minutos. Esta es la rama que
    // ahorra la ida y vuelta en prácticamente todas las peticiones.
    expect(necesitaRefresco(dentroDe(58 * 60_000), AHORA)).toBe(false);
  });

  it("refresca cuando queda menos que el margen", () => {
    expect(necesitaRefresco(dentroDe(30_000), AHORA)).toBe(true);
  });

  it("refresca un token ya caducado", () => {
    // Pasa cada vez que el equipo se queda quieto más de una hora, que en hostelería es
    // media tarde.
    expect(necesitaRefresco(dentroDe(-5 * 60_000), AHORA)).toBe(true);
  });

  it("justo en el margen refresca: en la duda, de más", () => {
    expect(necesitaRefresco(dentroDe(MARGEN_MS), AHORA)).toBe(true);
    expect(necesitaRefresco(dentroDe(MARGEN_MS + 1), AHORA)).toBe(false);
  });

  it("sin sesión o sin fecha se comporta como antes del cambio", () => {
    // Ante la duda, refrescar: nunca dejar de refrescar por no saber leer la fecha.
    expect(necesitaRefresco(null, AHORA)).toBe(true);
    expect(necesitaRefresco(undefined, AHORA)).toBe(true);
    expect(necesitaRefresco(0, AHORA)).toBe(true);
  });
});
