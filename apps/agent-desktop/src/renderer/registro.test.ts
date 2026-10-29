import { describe, expect, it } from "vitest";
import { entradasDelRegistro, filtrar } from "./registro.js";

// Como las devuelve `read-log`: de la más reciente a la más antigua.
const LINEAS = [
  "2026-10-29T20:04:12.000Z [info] Impresos 2 ticket(s) (total 42).",
  "    at fetch (node:internal/deps/undici:1)",
  "TypeError: fetch failed",
  "2026-10-29T19:41:02.000Z [error] Sin conexión con la plataforma: fetch failed",
  "2026-10-29T19:03:55.000Z [warn] Impresora de cocina sin responder (pedido #318): ECONNREFUSED.",
];

describe("entradasDelRegistro", () => {
  it("separa fecha, nivel y mensaje, y pega la traza a su error en el orden del fichero", () => {
    const [primera, error, aviso] = entradasDelRegistro(LINEAS);
    expect(primera).toMatchObject({ nivel: "info", mensaje: "Impresos 2 ticket(s) (total 42)." });
    expect(primera?.cuando?.toISOString()).toBe("2026-10-29T20:04:12.000Z");
    expect(error).toMatchObject({
      nivel: "error",
      detalle: ["TypeError: fetch failed", "    at fetch (node:internal/deps/undici:1)"],
    });
    expect(aviso?.nivel).toBe("aviso");
  });

  it("una línea sin formato no se pierde", () => {
    expect(entradasDelRegistro(["algo suelto"])).toEqual([
      { cuando: null, nivel: "info", mensaje: "algo suelto", detalle: [] },
    ]);
  });

  it("sin líneas, sin entradas", () => {
    expect(entradasDelRegistro([])).toEqual([]);
  });
});

describe("filtrar", () => {
  const entradas = entradasDelRegistro(LINEAS);

  it("«avisos» incluye los errores; «errores», solo errores", () => {
    expect(filtrar(entradas, "avisos").map((e) => e.nivel)).toEqual(["error", "aviso"]);
    expect(filtrar(entradas, "errores").map((e) => e.nivel)).toEqual(["error"]);
    expect(filtrar(entradas, "todo")).toHaveLength(3);
  });
});
