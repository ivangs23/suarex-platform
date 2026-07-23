import { checkRateLimit } from "@suarex/db";
import { afterEach, describe, expect, it } from "vitest";
import { admin } from "./helpers/tenants.js";

/**
 * El rate-limit es lo único que impide que un QR fotografiado sature la cocina de comandas.
 * Se comprueba el contador de ventana fija directamente contra la RPC en Postgres, que es
 * donde vive de verdad -- un límite en memoria de proceso sería inútil con más de un proceso.
 */

const claves: string[] = [];

afterEach(async () => {
  if (claves.length === 0) return;
  await admin.from("rate_limit_hits").delete().in("key", claves);
  claves.length = 0;
});

function claveUnica(): string {
  const k = `test-${crypto.randomUUID()}`;
  claves.push(k);
  return k;
}

describe("checkRateLimit", () => {
  it("permite hasta el tope y deniega a partir de ahí", async () => {
    const key = claveUnica();
    // Tope 3 en una ventana amplia: los 3 primeros pasan, el 4º no.
    expect(await checkRateLimit("test", key, 60, 3)).toBe(true);
    expect(await checkRateLimit("test", key, 60, 3)).toBe(true);
    expect(await checkRateLimit("test", key, 60, 3)).toBe(true);
    expect(await checkRateLimit("test", key, 60, 3)).toBe(false);
    expect(await checkRateLimit("test", key, 60, 3)).toBe(false);
  });

  it("cuenta por (bucket, key): claves distintas no comparten cupo", async () => {
    const a = claveUnica();
    const b = claveUnica();
    // Agotar A no gasta nada de B: una mesa saturada no bloquea a la de al lado.
    expect(await checkRateLimit("test", a, 60, 1)).toBe(true);
    expect(await checkRateLimit("test", a, 60, 1)).toBe(false);
    expect(await checkRateLimit("test", b, 60, 1)).toBe(true);
  });

  it("la ventana se reinicia: pasado el plazo vuelve a permitir", async () => {
    const key = claveUnica();
    // Ventana de 0 s: cada llamada ve la anterior ya vencida y reinicia el contador a 1.
    expect(await checkRateLimit("test", key, 0, 1)).toBe(true);
    expect(await checkRateLimit("test", key, 0, 1)).toBe(true);
  });

  it("un bucket distinto con la misma key tampoco comparte cupo", async () => {
    const key = claveUnica();
    expect(await checkRateLimit("bucketA", key, 60, 1)).toBe(true);
    expect(await checkRateLimit("bucketA", key, 60, 1)).toBe(false);
    // Otro bucket, misma key: cupo propio.
    expect(await checkRateLimit("bucketB", key, 60, 1)).toBe(true);
  });
});
