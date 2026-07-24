import type { AgentTickResult } from "@suarex/agent";
import { describe, expect, it } from "vitest";
import { type AgentActivity, INITIAL_ACTIVITY, reduceActivity } from "./agent-activity.js";

const tick = (over: Partial<AgentTickResult> = {}): AgentTickResult => ({
  printed: 0,
  failed: 0,
  succeeded: [],
  failures: [],
  ...over,
});

const T = "2026-07-24T10:00:00.000Z";

describe("reduceActivity", () => {
  it("acumula impresos y fallos y sella la hora del tick", () => {
    const { activity } = reduceActivity(INITIAL_ACTIVITY, tick({ printed: 2, failed: 0 }), T);
    expect(activity.printedTotal).toBe(2);
    expect(activity.lastTickAt).toBe(T);
  });

  it("marca una impresora caída y la avisa una sola vez", () => {
    const fallo = {
      printerId: "p1",
      orderNumber: 7,
      destination: "cocina" as const,
      reason: "timeout",
    };
    const first = reduceActivity(INITIAL_ACTIVITY, tick({ failed: 1, failures: [fallo] }), T);
    expect(first.alerts.newlyDown).toHaveLength(1);
    expect(first.activity.downPrinters).toEqual([
      { printerId: "p1", destination: "cocina", reason: "timeout" },
    ]);

    // Segundo tick, misma impresora sigue caída: NO se vuelve a avisar.
    const second = reduceActivity(first.activity, tick({ failed: 1, failures: [fallo] }), T);
    expect(second.alerts.newlyDown).toHaveLength(0);
    expect(second.activity.downPrinters).toHaveLength(1);
  });

  it("retira el aviso cuando la impresora vuelve a imprimir", () => {
    const down: AgentActivity = {
      ...INITIAL_ACTIVITY,
      downPrinters: [{ printerId: "p1", destination: "cocina", reason: "timeout" }],
    };
    const { activity, alerts } = reduceActivity(down, tick({ printed: 1, succeeded: ["p1"] }), T);
    expect(alerts.recovered).toEqual(["p1"]);
    expect(activity.downPrinters).toHaveLength(0);
  });

  it("una impresora que imprime un pedido y falla otro en el mismo tick cuenta como viva", () => {
    const down: AgentActivity = {
      ...INITIAL_ACTIVITY,
      downPrinters: [{ printerId: "p1", destination: "all", reason: "x" }],
    };
    const r = reduceActivity(
      down,
      tick({
        printed: 1,
        failed: 1,
        succeeded: ["p1"],
        failures: [{ printerId: "p1", orderNumber: 9, destination: "all", reason: "x" }],
      }),
      T,
    );
    expect(r.alerts.recovered).toEqual(["p1"]);
    expect(r.alerts.newlyDown).toHaveLength(0);
    expect(r.activity.downPrinters).toHaveLength(0);
  });

  it("guarda el error del tick entero y lo limpia al siguiente tick sano", () => {
    const conError = reduceActivity(INITIAL_ACTIVITY, tick({ error: "sin red" }), T);
    expect(conError.activity.lastError).toBe("sin red");

    const sano = reduceActivity(conError.activity, tick({ printed: 1 }), T);
    expect(sano.activity.lastError).toBeNull();
  });
});
