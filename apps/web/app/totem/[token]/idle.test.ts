import { describe, expect, it } from "vitest";
import { graceSecondsLeft, idlePhase } from "./idle.js";

const IDLE = 90_000;
const GRACE = 15_000;

describe("idlePhase", () => {
  it("mientras hay actividad reciente, no pasa nada", () => {
    expect(idlePhase(0, IDLE, GRACE)).toBe("active");
    expect(idlePhase(IDLE - 1, IDLE, GRACE)).toBe("active");
  });

  it("al cumplirse el tiempo de inactividad, avisa antes de borrar nada", () => {
    expect(idlePhase(IDLE, IDLE, GRACE)).toBe("warning");
    expect(idlePhase(IDLE + GRACE - 1, IDLE, GRACE)).toBe("warning");
  });

  it("solo tras el margen del aviso se da por abandonado", () => {
    expect(idlePhase(IDLE + GRACE, IDLE, GRACE)).toBe("expired");
    expect(idlePhase(IDLE + GRACE + 60_000, IDLE, GRACE)).toBe("expired");
  });
});

describe("graceSecondsLeft", () => {
  it("cuenta atrás desde que empieza el aviso", () => {
    expect(graceSecondsLeft(IDLE, IDLE, GRACE)).toBe(15);
    expect(graceSecondsLeft(IDLE + 5_000, IDLE, GRACE)).toBe(10);
  });

  it("redondea hacia arriba: mientras quede algo de segundo, se enseña ese segundo", () => {
    expect(graceSecondsLeft(IDLE + 14_100, IDLE, GRACE)).toBe(1);
  });

  it("nunca baja de cero aunque el totem lleve horas parado", () => {
    expect(graceSecondsLeft(IDLE + GRACE, IDLE, GRACE)).toBe(0);
    expect(graceSecondsLeft(IDLE + GRACE + 3_600_000, IDLE, GRACE)).toBe(0);
  });
});
