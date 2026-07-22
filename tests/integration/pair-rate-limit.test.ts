import { checkPairRateLimit } from "@suarex/db";
import { afterEach, describe, expect, it } from "vitest";
import { admin } from "./helpers/tenants.js";

// Cada test usa una IP única para no chocar con otras corridas/ficheros.
const usedIps: string[] = [];
afterEach(async () => {
  for (const ip of usedIps.splice(0)) {
    await admin.from("pair_attempts").delete().eq("ip", ip);
  }
});

describe("checkPairRateLimit", () => {
  it("permite hasta el máximo y bloquea el siguiente en la misma ventana", async () => {
    const ip = `1.2.3.${Math.floor(Math.random() * 1000)}-${Date.now()}`;
    usedIps.push(ip);
    // Con la RPC directa acotamos la ventana a 60s y el máximo a 3 para el test.
    const call = () =>
      admin.rpc("check_pair_rate_limit", { p_ip: ip, p_window_seconds: 60, p_max: 3 });
    expect((await call()).data).toBe(true); // 1
    expect((await call()).data).toBe(true); // 2
    expect((await call()).data).toBe(true); // 3
    expect((await call()).data).toBe(false); // 4 -> bloqueado
  });

  it("una IP distinta no se ve afectada", async () => {
    const ipA = `9.9.9.${Date.now()}`;
    const ipB = `8.8.8.${Date.now()}`;
    usedIps.push(ipA, ipB);
    await admin.rpc("check_pair_rate_limit", { p_ip: ipA, p_window_seconds: 60, p_max: 1 });
    await admin.rpc("check_pair_rate_limit", { p_ip: ipA, p_window_seconds: 60, p_max: 1 }); // ipA bloqueada
    const { data } = await admin.rpc("check_pair_rate_limit", {
      p_ip: ipB,
      p_window_seconds: 60,
      p_max: 1,
    });
    expect(data).toBe(true); // ipB sigue permitida
  });

  it("pasada la ventana, el contador reinicia", async () => {
    const ip = `7.7.7.${Date.now()}`;
    usedIps.push(ip);
    await admin.rpc("check_pair_rate_limit", { p_ip: ip, p_window_seconds: 60, p_max: 1 });
    const blocked = await admin.rpc("check_pair_rate_limit", {
      p_ip: ip,
      p_window_seconds: 60,
      p_max: 1,
    });
    expect(blocked.data).toBe(false);
    // Simula que la ventana ya pasó retrasando window_start.
    await admin
      .from("pair_attempts")
      .update({ window_start: new Date(Date.now() - 120_000).toISOString() })
      .eq("ip", ip);
    const afterWindow = await admin.rpc("check_pair_rate_limit", {
      p_ip: ip,
      p_window_seconds: 60,
      p_max: 1,
    });
    expect(afterWindow.data).toBe(true); // reiniciado
  });

  it("el wrapper checkPairRateLimit usa ventana 60s y máx 10", async () => {
    const ip = `5.5.5.${Date.now()}`;
    usedIps.push(ip);
    let last = true;
    for (let i = 0; i < 11; i += 1) last = await checkPairRateLimit(ip);
    expect(last).toBe(false); // el 11º supera el máx de 10
  });
});
