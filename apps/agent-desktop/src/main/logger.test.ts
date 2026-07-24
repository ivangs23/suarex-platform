import { describe, expect, it } from "vitest";
import { createLogger, describeError, formatLine, type LogSink } from "./logger.js";

/** Sink falso en memoria (mismo espíritu que `fakeBackend` en config-store.test): recoge las
 *  líneas sin tocar `fs`. */
function fakeSink(): LogSink & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    append: (line) => {
      lines.push(line);
    },
    read: () => lines.map((l) => `${l}\n`).join(""),
  };
}

const NOW = "2026-07-24T10:00:00.000Z";

describe("formatLine", () => {
  it("formatea <iso> [nivel] mensaje", () => {
    expect(formatLine(NOW, "info", "hola")).toBe(`${NOW} [info] hola`);
    expect(formatLine(NOW, "error", "roto")).toBe(`${NOW} [error] roto`);
  });
});

describe("createLogger", () => {
  it("escribe una línea por nivel, con la etiqueta y el instante inyectado", () => {
    const sink = fakeSink();
    const log = createLogger(sink, () => NOW);
    log.info("arranque");
    log.warn("cuidado");
    log.error("roto");
    expect(sink.lines).toEqual([
      `${NOW} [info] arranque`,
      `${NOW} [warn] cuidado`,
      `${NOW} [error] roto`,
    ]);
  });

  it("error con un Error adjunto añade su stack tras el mensaje", () => {
    const sink = fakeSink();
    const log = createLogger(sink, () => NOW);
    log.error("falló el arranque", new Error("boom"));
    expect(sink.lines[0]).toContain("[error] falló el arranque ");
    expect(sink.lines[0]).toContain("boom");
  });
});

describe("describeError", () => {
  it("usa el stack de un Error", () => {
    const e = new Error("x");
    expect(describeError(e)).toBe(e.stack);
  });
  it("pasa una string tal cual", () => {
    expect(describeError("texto suelto")).toBe("texto suelto");
  });
  it("serializa un objeto plano", () => {
    expect(describeError({ a: 1 })).toBe('{"a":1}');
  });
});
