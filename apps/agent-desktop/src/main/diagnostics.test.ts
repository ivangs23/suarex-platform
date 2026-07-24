import { describe, expect, it } from "vitest";
import type { AgentActivity } from "./agent-activity.js";
import { type DiagnosticsMeta, formatDiagnostics } from "./diagnostics.js";

const META: DiagnosticsMeta = {
  generatedAt: "2026-07-24T10:00:00.000Z",
  appVersion: "1.2.3",
  platform: "win32",
  paired: true,
  deviceId: "dev-1",
  running: true,
};

const ACTIVITY: AgentActivity = {
  lastTickAt: "2026-07-24T09:59:00.000Z",
  printedTotal: 5,
  failedTotal: 1,
  lastError: null,
  downPrinters: [{ printerId: "p1", destination: "cocina", reason: "sin conexión" }],
};

describe("formatDiagnostics", () => {
  it("incluye metadatos, la actividad y el volcado del registro", () => {
    const out = formatDiagnostics(META, ACTIVITY, "linea1\nlinea2\n");
    expect(out).toMatch(/Versión:\s+1\.2\.3/);
    expect(out).toMatch(/Emparejado:\s+sí \(dispositivo dev-1\)/);
    expect(out).toMatch(/Agente en marcha:\s+sí/);
    expect(out).toMatch(/Tickets impresos:\s+5/);
    // El destino se traduce al nombre que el owner reconoce y lleva el motivo entre paréntesis.
    expect(out).toContain("cocina (sin conexión)");
    expect(out).toContain("--- Registro ---");
    expect(out).toContain("linea1");
    expect(out).toContain("linea2");
  });

  it("refleja el caso sin emparejar, sin actividad y con log vacío", () => {
    const out = formatDiagnostics(
      { ...META, paired: false, deviceId: null, running: false },
      { lastTickAt: null, printedTotal: 0, failedTotal: 0, lastError: null, downPrinters: [] },
      "",
    );
    expect(out).toMatch(/Emparejado:\s+no/);
    expect(out).toMatch(/Agente en marcha:\s+no/);
    expect(out).toMatch(/Última comprobación:\s+\(ninguna\)/);
    expect(out).toContain("Impresoras sin responder ahora: (ninguna)");
    expect(out).toContain("(vacío)");
  });
});
