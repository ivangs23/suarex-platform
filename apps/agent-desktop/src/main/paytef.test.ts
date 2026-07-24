import { describe, expect, it } from "vitest";
import {
  buildStartPayload,
  chargePaytef,
  interpretPollBody,
  type PaytefBridgeConfig,
  type PaytefTransport,
} from "./paytef.js";

const CFG: PaytefBridgeConfig = {
  accessKey: "AK",
  secretKey: "SK",
  companyId: "115925",
  pinpad: "02290357044",
  mock: false,
};

const noSleep = () => Promise.resolve();

describe("buildStartPayload", () => {
  it("compone el payload de venta con importe en céntimos y polling", () => {
    const p = buildStartPayload(1250, "PIN1", "ORD-abc-1");
    expect(p).toMatchObject({
      opType: "sale",
      requestedAmount: 1250,
      pinpad: "PIN1",
      transactionReference: "ORD-abc-1",
      executeOptions: { method: "polling" },
      createReceipt: false,
    });
  });
});

describe("interpretPollBody", () => {
  it("aprobado -> final con authCode", () => {
    expect(interpretPollBody({ result: { approved: true, authorisationCode: "123456" } })).toEqual({
      kind: "final",
      approved: true,
      authCode: "123456",
    });
  });
  it("denegado -> final con motivo", () => {
    expect(interpretPollBody({ result: { approved: false, resultText: "Denegada" } })).toEqual({
      kind: "final",
      approved: false,
      reason: "Denegada",
    });
  });
  it("leyendo tarjeta -> progreso", () => {
    expect(interpretPollBody({ info: { cardStatus: "readingCard" } })).toEqual({
      kind: "progress",
      status: "processing",
    });
  });
  it("sin datos aún -> none", () => {
    expect(interpretPollBody({ info: {} }).kind).toBe("none");
    expect(interpretPollBody(null).kind).toBe("none");
  });
});

describe("chargePaytef (mock)", () => {
  it("aprueba y emite estados hasta success", async () => {
    const estados: string[] = [];
    const r = await chargePaytef({ ...CFG, mock: true }, 500, "ORD-1", {
      onStatus: (s) => estados.push(s),
      sleep: noSleep,
    });
    expect(r).toEqual({ approved: true, authCode: "MOCK-000000" });
    expect(estados).toContain("waiting_card");
    expect(estados.at(-1)).toBe("success");
  });

  it("si se cancela, devuelve no aprobado sin cobrar", async () => {
    const r = await chargePaytef({ ...CFG, mock: true }, 500, "ORD-1", {
      isCancelled: () => true,
      sleep: noSleep,
    });
    expect(r.approved).toBe(false);
  });
});

describe("chargePaytef (real, transporte fake)", () => {
  /** Fake que responde por path: auth -> token, start -> sessionID, poll -> lo que se le diga. */
  function fakeTransport(pollBodies: unknown[]): PaytefTransport {
    let pollIdx = 0;
    return async (path) => {
      if (path === "/authorize/") return { status: 200, body: { result: { token: "tk" } } };
      if (path === "/transaction/start")
        return { status: 200, body: { info: { sessionID: "sess" } } };
      if (path === "/transaction/poll") {
        const body = pollBodies[Math.min(pollIdx, pollBodies.length - 1)] as never;
        pollIdx += 1;
        return { status: 200, body };
      }
      return { status: 200, body: {} };
    };
  }

  it("aprueba tras un par de polls de progreso", async () => {
    const r = await chargePaytef(CFG, 999, "ORD-9", {
      transport: fakeTransport([
        { info: { cardStatus: "readingCard" } },
        { result: { approved: true, authorisationCode: "999999" } },
      ]),
      sleep: noSleep,
      pollIntervalMs: 0,
    });
    expect(r).toEqual({ approved: true, authCode: "999999" });
  });

  it("denegado por el banco", async () => {
    const r = await chargePaytef(CFG, 999, "ORD-9", {
      transport: fakeTransport([
        { result: { approved: false, resultText: "Fondos insuficientes" } },
      ]),
      sleep: noSleep,
      pollIntervalMs: 0,
    });
    expect(r).toEqual({ approved: false, reason: "Fondos insuficientes" });
  });

  it("timeout si nunca hay resultado", async () => {
    const r = await chargePaytef(CFG, 999, "ORD-9", {
      transport: fakeTransport([{ info: {} }]),
      sleep: noSleep,
      pollIntervalMs: 0,
      maxPolls: 3,
    });
    expect(r).toEqual({ approved: false, reason: "Tiempo de espera agotado" });
  });

  it("fallo de auth -> no aprobado", async () => {
    const r = await chargePaytef(CFG, 999, "ORD-9", {
      transport: async () => ({ status: 401, body: null }),
      sleep: noSleep,
    });
    expect(r.approved).toBe(false);
  });
});
