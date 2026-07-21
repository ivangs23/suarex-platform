import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Prueba, EJECUTABLE POR MÁQUINA, de que la garantía estructural de `packages/db` (ver
 * `packages/db/src/client.ts`) es un error real de TypeScript y no solo una convención:
 *
 *   1. `serviceClient` (el cliente sin ningún filtro de tenant) no se exporta desde
 *      `client.ts` -- ningún otro módulo del paquete puede importarlo.
 *   2. `tenantScoped(table, tenantId)` exige `tenantId` como argumento obligatorio --
 *      omitirlo no compila.
 *
 * El fixture en `packages/db/src/__compile_fixtures__/no-tenant-filter.fixture.ts` viola
 * ambas reglas a propósito. Está excluido del proyecto normal por
 * `packages/db/tsconfig.json` (`exclude`), así que NO participa en `pnpm typecheck`; este
 * test lo compila aparte, contra `tsconfig.fixture.json` (mismas opciones estrictas del
 * resto del paquete, heredadas via `extends`), y verifica que tsc falle con EXACTAMENTE
 * los dos códigos de error esperados -- no basta con "algo falló".
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const TSC_BIN = path.join(REPO_ROOT, "node_modules/.bin/tsc");
const FIXTURE_TSCONFIG = path.join(
  REPO_ROOT,
  "packages/db/src/__compile_fixtures__/tsconfig.fixture.json",
);

function compileFixture(): { exitCode: number; output: string } {
  try {
    const output = execFileSync(TSC_BIN, ["--noEmit", "-p", FIXTURE_TSCONFIG], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, output };
  } catch (err) {
    const failure = err as { status: number | null; stdout?: string; stderr?: string };
    return {
      exitCode: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("garantía estructural: sin filtro de tenant es un error de compilación", () => {
  it("tsc rechaza el fixture, y por las DOS razones exactas esperadas", () => {
    const { exitCode, output } = compileFixture();

    expect(exitCode, `tsc debía fallar contra el fixture pero no lo hizo:\n${output}`).not.toBe(0);

    expect(
      output,
      `esperaba TS2459 (serviceClient no exportado); salida real:\n${output}`,
    ).toContain("TS2459");
    expect(
      output,
      `esperaba el mensaje de 'serviceClient' no exportado; salida real:\n${output}`,
    ).toContain("declares 'serviceClient' locally, but it is not exported");

    expect(output, `esperaba TS2554 (tenantId omitido); salida real:\n${output}`).toContain(
      "TS2554",
    );
    expect(output, `esperaba el mensaje de argumento faltante; salida real:\n${output}`).toContain(
      "Expected 2 arguments, but got 1",
    );
  });
});
