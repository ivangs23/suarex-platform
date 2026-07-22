import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tenantScoped } from "../../packages/db/src/client.js";
import { admin, createTenantFixture, deleteTenantFixture } from "./helpers/tenants.js";

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

describe("tenantScoped.insert", () => {
  it("ignora un tenant_id ajeno que venga en la fila", async () => {
    const a = await createTenantFixture(`ins-a-${Date.now()}`);
    const b = await createTenantFixture(`ins-b-${Date.now()}`);

    await tenantScoped("categories", a.tenantId).insert({
      tenant_id: b.tenantId,
      slug: "intento",
      name_i18n: { es: "Intento" },
    });

    const { data } = await admin.from("categories").select("tenant_id").eq("slug", "intento");

    expect(data).toHaveLength(1);
    expect(data?.[0]?.tenant_id).toBe(a.tenantId);

    await admin.from("categories").delete().eq("slug", "intento");
    await deleteTenantFixture(a);
    await deleteTenantFixture(b);
  });
});

describe("tenantScoped.update", () => {
  it("ignora un tenant_id ajeno en los valores y un filtro no puede alcanzar la fila de otro tenant", async () => {
    const a = await createTenantFixture(`upd-a-${Date.now()}`);
    const b = await createTenantFixture(`upd-b-${Date.now()}`);

    const { data: rowA, error: rowAError } = await admin
      .from("categories")
      .insert({ tenant_id: a.tenantId, slug: "propia-a", name_i18n: { es: "Original A" } })
      .select("id")
      .single();
    if (rowAError) throw rowAError;

    const { data: rowB, error: rowBError } = await admin
      .from("categories")
      .insert({ tenant_id: b.tenantId, slug: "propia-b", name_i18n: { es: "Original B" } })
      .select("id")
      .single();
    if (rowBError) throw rowBError;

    // 1. Un `tenant_id` ajeno en los valores no reasigna la fila propia a otro tenant.
    await tenantScoped("categories", a.tenantId)
      .update({ tenant_id: b.tenantId, name_i18n: { es: "Renombrada A" } })
      .eq("id", rowA.id);

    const { data: afterOwnUpdate } = await admin
      .from("categories")
      .select("tenant_id, name_i18n")
      .eq("id", rowA.id)
      .single();

    expect(afterOwnUpdate?.tenant_id).toBe(a.tenantId);
    expect(afterOwnUpdate?.name_i18n).toEqual({ es: "Renombrada A" });

    // 2. Un `.eq()` encadenado que nombra la fila de otro tenant por su `id` no puede
    // alcanzarla: el filtro base `tenant_id = a.tenantId` ya aplicado excluye la fila de
    // B, así que la actualización afecta a cero filas y B queda intacta.
    const { data: crossByIdResult, error: crossByIdError } = await tenantScoped(
      "categories",
      a.tenantId,
    )
      .update({ name_i18n: { es: "Hackeada por id" } })
      .eq("id", rowB.id)
      .select("id");

    expect(crossByIdError).toBeNull();
    expect(crossByIdResult).toHaveLength(0);

    // 3. Un `.eq()` encadenado que nombra el `tenant_id` ajeno directamente tampoco puede
    // alcanzar ninguna fila (contradice el filtro base ya aplicado).
    const { data: crossByTenantResult, error: crossByTenantError } = await tenantScoped(
      "categories",
      a.tenantId,
    )
      .update({ name_i18n: { es: "Hackeada por tenant_id" } })
      .eq("tenant_id", b.tenantId)
      .select("id");

    expect(crossByTenantError).toBeNull();
    expect(crossByTenantResult).toHaveLength(0);

    const { data: rowBUntouched } = await admin
      .from("categories")
      .select("tenant_id, name_i18n")
      .eq("id", rowB.id)
      .single();

    expect(rowBUntouched?.tenant_id).toBe(b.tenantId);
    expect(rowBUntouched?.name_i18n).toEqual({ es: "Original B" });

    await admin.from("categories").delete().eq("id", rowA.id);
    await admin.from("categories").delete().eq("id", rowB.id);
    await deleteTenantFixture(a);
    await deleteTenantFixture(b);
  });
});
