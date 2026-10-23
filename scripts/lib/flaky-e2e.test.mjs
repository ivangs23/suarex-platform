import { describe, expect, it } from "vitest";
import { testsFlaky } from "./flaky-e2e.mjs";

/**
 * Informe con la forma del reporter `json` de Playwright 1.61: una suite por fichero (su
 * `title` es el propio fichero) y los `describe` como suites anidadas.
 */
const INFORME = {
  suites: [
    {
      title: "totem.spec.ts",
      file: "totem.spec.ts",
      specs: [
        {
          title: "pide y paga",
          file: "totem.spec.ts",
          line: 20,
          tests: [{ status: "flaky", results: [{ status: "failed" }, { status: "passed" }] }],
        },
        {
          title: "estable",
          file: "totem.spec.ts",
          line: 40,
          tests: [{ status: "expected", results: [{ status: "passed" }] }],
        },
      ],
      suites: [
        {
          title: "garum · movil",
          file: "totem.spec.ts",
          specs: [
            {
              title: "bienvenida",
              file: "totem.spec.ts",
              line: 67,
              tests: [
                {
                  status: "flaky",
                  results: [{ status: "timedOut" }, { status: "failed" }, { status: "passed" }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "recibo.spec.ts",
      file: "recibo.spec.ts",
      specs: [
        {
          title: "roto de verdad",
          file: "recibo.spec.ts",
          line: 9,
          tests: [{ status: "unexpected", results: [{}, {}, {}] }],
        },
      ],
    },
  ],
};

describe("testsFlaky", () => {
  it("lista los que pasaron al reintentar, también dentro de un describe", () => {
    expect(testsFlaky(INFORME)).toEqual([
      { ubicacion: "totem.spec.ts:20", titulo: "pide y paga", intentos: 2 },
      { ubicacion: "totem.spec.ts:67", titulo: "garum · movil › bienvenida", intentos: 3 },
    ]);
  });

  it("no cuenta los que fallaron los tres intentos: eso es un fallo, no un flaky", () => {
    expect(testsFlaky(INFORME).map((t) => t.titulo)).not.toContain("roto de verdad");
  });

  it("un informe vacío o sin suites no rompe", () => {
    expect(testsFlaky({})).toEqual([]);
    expect(testsFlaky(null)).toEqual([]);
  });
});
