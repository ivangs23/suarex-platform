import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `deploy/supabase-override.yml`, el único cambio sobre el compose oficial de Supabase. Sus dos
 * garantías son de seguridad: nada de la stack publicado fuera de loopback, y el hook del JWT
 * activado. Test estructural: lee el fichero, no levanta nada.
 */

const override = readFileSync(
  path.resolve(import.meta.dirname, "../../deploy/supabase-override.yml"),
  "utf8",
);

/** Las líneas de puertos de un servicio del override (sin comentarios). */
function puertos(servicio: string): string[] {
  const bloque = override.match(
    new RegExp(`^  ${servicio}:\\n([\\s\\S]*?)(?=^  \\S|(?![\\s\\S]))`, "m"),
  );
  return (bloque?.[1] ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
}

describe("deploy/supabase-override.yml", () => {
  it.each([
    ["db", "127.0.0.1:5432:5432"],
    ["supavisor", "127.0.0.1:6543:6543"],
    // Desde octubre de 2026 el gateway es Envoy y el compose oficial lo publica en 0.0.0.0.
    ["api-gw", "127.0.0.1:8000:8000"],
  ])("%s solo publica en loopback", (servicio, mapeo) => {
    expect(override).toMatch(new RegExp(`^  ${servicio}:\\n    ports: !override`, "m"));
    expect(puertos(servicio)).toEqual([`- "${mapeo}"`]);
  });

  it("activa el hook que mete tenant_id en el JWT", () => {
    // Sin él, RLS no acota nada y cada usuario ve la base entera.
    expect(override).toContain('GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: "true"');
    expect(override).toContain(
      'GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI: "pg-functions://postgres/public/custom_access_token_hook"',
    );
  });
});
