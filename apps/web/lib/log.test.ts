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

describe("redacción en objetos anidados", () => {
  it("redacta también dentro de objetos anidados", () => {
    // El agujero que esto cierra: la redacción solo miraba el primer nivel, así que
    // `log.error("x", { pedido })` habría escrito las notas del comensal enteras. Una
    // garantía que depende de cómo el llamante estructure su objeto no es una garantía.
    const linea = JSON.parse(
      lineaDeLog("error", "x", {
        pedido: { id: "ok-visible", notes: "para la alérgica", cliente: { email: "a@b.com" } },
      }),
    );
    expect(linea.pedido.id).toBe("ok-visible");
    expect(linea.pedido.notes).toBe("[redactado]");
    expect(linea.pedido.cliente.email).toBe("[redactado]");
  });

  it("redacta dentro de arrays", () => {
    const linea = JSON.parse(
      lineaDeLog("error", "x", { lineas: [{ id: "1", notes: "sin cebolla" }] }),
    );
    expect(linea.lineas[0].id).toBe("1");
    expect(linea.lineas[0].notes).toBe("[redactado]");
  });

  it("corta los OBJETOS a profundidad 4, pero conserva los primitivos", () => {
    // Un valor primitivo hondo no cuesta nada y puede ser justo el dato que buscas; lo que
    // se corta son los objetos, que es donde crece el riesgo de ciclos y de ruido.
    const conPrimitivo = { a: { b: { c: { d: { e: "muy hondo" } } } } };
    expect(JSON.stringify(JSON.parse(lineaDeLog("error", "x", conPrimitivo)))).toContain(
      "muy hondo",
    );

    const conObjeto = { a: { b: { c: { d: { e: { f: "demasiado" } } } } } };
    const linea = JSON.parse(lineaDeLog("error", "x", conObjeto));
    expect(JSON.stringify(linea)).toContain("[profundo]");
    expect(JSON.stringify(linea)).not.toContain("demasiado");
  });

  it("sigue sin lanzar con una referencia circular anidada", () => {
    const o: Record<string, unknown> = { nivel: 1 };
    o.yo = o;
    expect(() => lineaDeLog("error", "x", { raiz: o })).not.toThrow();
  });
});
