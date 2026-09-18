import { describe, expect, it, vi } from "vitest";
import { CLAVES_PROHIBIDAS, lineaDeLog, log } from "./log";

describe("lineaDeLog", () => {
  it("emite una línea JSON con nivel, evento y marca de tiempo", () => {
    const linea = JSON.parse(
      lineaDeLog("error", "pedido.fallo", { orderId: "abc" }, "2026-09-18T10:00:00.000Z"),
    );
    expect(linea).toMatchObject({ level: "error", event: "pedido.fallo", orderId: "abc" });
    expect(linea.ts).toBe("2026-09-18T10:00:00.000Z");
  });

  it("REDACTA los campos que pueden llevar datos personales", () => {
    // La garantía del spec: ningún dato personal en los logs. `notes` es texto libre escrito
    // por el comensal -- ahí acaba "para la alérgica" o "mesa de Marta" -- y los logs viven
    // fuera de los plazos de retención que promete la política de privacidad. Un log con
    // notas dentro convierte el logger en un tratamiento no declarado.
    const linea = JSON.parse(
      lineaDeLog("error", "x", {
        orderId: "ok-visible",
        notes: "para la alérgica",
        email: "cliente@ejemplo.com",
        password: "secreta",
        authorization: "Bearer xyz",
        token: "abc123",
      }),
    );
    expect(linea.orderId).toBe("ok-visible");
    for (const clave of ["notes", "email", "password", "authorization", "token"]) {
      expect(linea[clave], `${clave} debía redactarse`).toBe("[redactado]");
    }
  });

  it("redacta sin importar mayúsculas ni prefijos", () => {
    const linea = JSON.parse(
      lineaDeLog("error", "x", { userEmail: "a@b.com", Notes: "x", ACCESS_TOKEN: "y" }),
    );
    expect(linea.userEmail).toBe("[redactado]");
    expect(linea.Notes).toBe("[redactado]");
    expect(linea.ACCESS_TOKEN).toBe("[redactado]");
  });

  it("la lista de claves prohibidas no está vacía y cubre lo obvio", () => {
    // Si alguien la vacía por error, este test lo dice antes de que los logs empiecen a
    // llevar correos dentro.
    for (const clave of ["notes", "email", "password", "token"]) {
      expect(CLAVES_PROHIBIDAS).toContain(clave);
    }
  });

  it("convierte un Error en mensaje y tipo, nunca el stack entero", () => {
    // El stack puede llevar rutas del servidor y, en un error de Postgres, fragmentos de la
    // consulta con valores dentro.
    const linea = JSON.parse(lineaDeLog("error", "x", { error: new TypeError("algo falló") }));
    expect(linea.error).toEqual({ tipo: "TypeError", mensaje: "algo falló" });
  });

  it("no revienta con valores raros", () => {
    // Un logger que lanza dentro de un catch convierte un error manejado en un 500.
    expect(() =>
      lineaDeLog("error", "x", {
        ciclo: (() => {
          const o: Record<string, unknown> = {};
          o.yo = o;
          return o;
        })(),
      }),
    ).not.toThrow();
    expect(() => lineaDeLog("error", "x", { fn: () => {}, u: undefined, n: null })).not.toThrow();
  });
});

describe("log", () => {
  it("escribe en stderr para error y en stdout para info", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const inf = vi.spyOn(console, "info").mockImplementation(() => {});

    log.error("a.b", { x: 1 });
    log.info("c.d", { y: 2 });

    expect(err).toHaveBeenCalledOnce();
    expect(inf).toHaveBeenCalledOnce();
    expect(JSON.parse(err.mock.calls[0]?.[0] as string).event).toBe("a.b");
    expect(JSON.parse(inf.mock.calls[0]?.[0] as string).event).toBe("c.d");

    err.mockRestore();
    inf.mockRestore();
  });
});
