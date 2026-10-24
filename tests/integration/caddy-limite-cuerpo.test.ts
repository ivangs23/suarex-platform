import { describe, expect, it } from "vitest";
import {
  MAX_CANTIDAD_LINEA,
  MAX_EXTRAS_LINEA,
  MAX_LINEAS_PEDIDO,
  MAX_NOTAS_LINEA,
} from "../../packages/domain/src/limites-pedido.js";
import { bloquesDeSitio, leerCaddyfile } from "./helpers/caddyfile.js";

/**
 * Tope al cuerpo de `/api/*` en `deploy/Caddyfile`. Test estructural, como
 * `security-headers.test.ts`: lee el fichero, no levanta Caddy.
 */

/** Unidades de tamaño de Caddy: `MB` es decimal, `MiB` binario. */
const UNIDADES: Record<string, number> = { KB: 1e3, MB: 1e6, KiB: 1024, MiB: 1024 ** 2 };

/** Los `request_body <matcher> { max_size <n><unidad> }` de un bloque, en bytes. */
function topes(cuerpo: string): { matcher: string; bytes: number }[] {
  return [...cuerpo.matchAll(/^\s*request_body\s+(\S+)\s*\{\s*max_size\s+(\d+)(\w+)\s*\}/gm)].map(
    (m) => ({
      matcher: m[1] ?? "",
      bytes: Number(m[2]) * (UNIDADES[m[3] ?? ""] ?? Number.NaN),
    }),
  );
}

/** El pedido legítimo más grande: todos los límites al máximo y cada carácter de la nota
 *  escapado a `\uXXXX` (6 bytes, el peor caso de JSON). */
function bytesDelPeorPedido(): number {
  const uuid = "00000000-0000-0000-0000-000000000000";
  const linea = {
    productId: uuid,
    quantity: MAX_CANTIDAD_LINEA,
    extraIds: Array.from({ length: MAX_EXTRAS_LINEA }, () => uuid),
    notes: "\u0000".repeat(MAX_NOTAS_LINEA),
  };
  const lines = Array.from({ length: MAX_LINEAS_PEDIDO }, () => linea);
  return Buffer.byteLength(JSON.stringify({ token: uuid, tableLabel: "Terraza 12", lines }));
}

describe("deploy/Caddyfile: tope al cuerpo de /api/*", () => {
  const bloques = bloquesDeSitio(leerCaddyfile());

  it("los dos bloques de sitio limitan /api/*", () => {
    // Plataforma y dominios propios sirven las mismas rutas: los dos necesitan el tope.
    expect(bloques).toHaveLength(2);
    for (const { cuerpo } of bloques) {
      expect(topes(cuerpo).map((t) => t.matcher)).toEqual(["/api/*"]);
    }
  });

  it("el tope deja pasar el pedido más grande que aceptan las rutas", () => {
    // Si alguien sube los límites de `limites-pedido.ts` por encima del tope, los pedidos
    // grandes empezarían a dar 413 en Caddy, sin llegar a la validación que explica el rechazo.
    const peor = bytesDelPeorPedido();
    for (const { cuerpo } of bloques) {
      for (const { bytes } of topes(cuerpo)) expect(bytes).toBeGreaterThan(peor);
    }
  });

  it("la API de Supabase (Kong) no lleva el tope", () => {
    // Por `api.<dominio>` pasan las subidas a Storage, que son de varios MB.
    const plataforma = bloques.find((b) => b.cabecera.includes("{$PLATFORM_DOMAIN}"));
    const kong = plataforma?.cuerpo.match(/handle @api \{([\s\S]*?)\n\t\}/)?.[1];
    expect(kong).toContain("reverse_proxy kong:8000");
    expect(kong).not.toContain("request_body");
  });
});
