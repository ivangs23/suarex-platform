import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `packages/db/src/database.types.ts` va en git (CI no lo genera): este test lo regenera desde la
 * base local con el MISMO comando que `pnpm db:types` y falla si no coincide. Una migración sin
 * regenerar los tipos pone rojo esto, en vez de dejar al compilador defendiendo un esquema viejo.
 *
 * La CLI de Supabase es un binario nativo, no un `.js`: se invoca por su nombre, igual que en
 * `scripts/write-test-env.mjs`, y no con `process.execPath` como `tsc` en
 * `tenant-filter-structural.test.ts`.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const COMMITEADO = path.join(REPO_ROOT, "packages/db/src/database.types.ts");
// Los mismos argumentos que el script `db:types` del package.json raíz.
const ARGS = ["gen", "types", "typescript", "--local", "--schema", "public"];

const sinCrlf = (texto: string) => texto.replace(/\r\n/g, "\n");

describe("database.types.ts", () => {
  it("coincide con el esquema de las migraciones", () => {
    const generado = execFileSync("supabase", ARGS, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(
      sinCrlf(readFileSync(COMMITEADO, "utf8")),
      "database.types.ts no coincide con las migraciones: corre `pnpm db:types`",
    ).toBe(sinCrlf(generado));
  }, 120_000);
});
