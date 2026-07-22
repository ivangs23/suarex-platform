import { describe, expect, it } from "vitest";
import { pairDevice } from "./pairing.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("pairDevice", () => {
  it("200 devuelve las credenciales", async () => {
    const f = fakeFetch(200, { deviceId: "d1", email: "e@x", password: "p", tenantId: "t1" });
    const r = await pairDevice("http://host", "CODE", f);
    expect(r).toEqual({ deviceId: "d1", email: "e@x", password: "p", tenantId: "t1" });
  });

  it("404 lanza invalid-code", async () => {
    await expect(pairDevice("http://host", "X", fakeFetch(404, { error: "x" }))).rejects.toMatchObject({
      kind: "invalid-code",
    });
  });

  it("429 lanza rate-limited", async () => {
    await expect(pairDevice("http://host", "X", fakeFetch(429, { error: "x" }))).rejects.toMatchObject({
      kind: "rate-limited",
    });
  });

  it("un fallo de red lanza network", async () => {
    const f = (async () => {
      throw new Error("boom");
    }) as typeof fetch;
    await expect(pairDevice("http://host", "X", f)).rejects.toMatchObject({ kind: "network" });
  });
});
