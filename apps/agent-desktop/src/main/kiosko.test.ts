import { describe, expect, it, vi } from "vitest";
import { type ChargeOrderDeps, chargeOrder } from "./kiosko.js";
import type { PaytefBridgeConfig } from "./paytef.js";

const CONFIG: PaytefBridgeConfig = {
  accessKey: "AK",
  secretKey: "SK",
  companyId: "1",
  pinpad: "PIN",
  mock: true,
};

function deps(over: Partial<ChargeOrderDeps> = {}): ChargeOrderDeps {
  return {
    readOrder: async () => ({ amountCents: 1250, status: "pending" }),
    getConfig: async () => CONFIG,
    charge: async () => ({ approved: true, authCode: "OK123" }),
    markPaid: async () => true,
    ...over,
  };
}

describe("chargeOrder", () => {
  it("aprobado: cobra el importe del SERVIDOR y marca pagado", async () => {
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "OK123" }));
    const markPaid = vi.fn(async () => true);
    const r = await chargeOrder(deps({ charge, markPaid }), "ord-1", { now: () => 42 });
    expect(r).toEqual({ ok: true, authCode: "OK123" });
    // El importe cobrado es el de readOrder (1250), no uno del caller; la referencia lleva el id.
    expect(charge).toHaveBeenCalledWith(CONFIG, 1250, "ORD-ord-1-42", expect.anything());
    expect(markPaid).toHaveBeenCalledWith("ord-1");
  });

  it("denegado: no marca pagado", async () => {
    const markPaid = vi.fn(async () => true);
    const r = await chargeOrder(
      deps({ charge: async () => ({ approved: false, reason: "Denegada" }), markPaid }),
      "ord-1",
    );
    expect(r).toEqual({ ok: false, reason: "Denegada" });
    expect(markPaid).not.toHaveBeenCalled();
  });

  it("pedido ya pagado: idempotente, no vuelve a cobrar", async () => {
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "X" }));
    const r = await chargeOrder(
      deps({ readOrder: async () => ({ amountCents: 500, status: "paid" }), charge }),
      "ord-1",
    );
    expect(r.ok).toBe(true);
    expect(charge).not.toHaveBeenCalled();
  });

  it("pedido no encontrado: falla sin cobrar", async () => {
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "X" }));
    const r = await chargeOrder(deps({ readOrder: async () => null, charge }), "ord-1");
    expect(r).toEqual({ ok: false, reason: "Pedido no encontrado" });
    expect(charge).not.toHaveBeenCalled();
  });

  it("sin config de datáfono: falla sin cobrar", async () => {
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "X" }));
    const r = await chargeOrder(deps({ getConfig: async () => null, charge }), "ord-1");
    expect(r.ok).toBe(false);
    expect(charge).not.toHaveBeenCalled();
  });

  it("aprobado pero no se pudo marcar pagado: error con el authCode a la vista", async () => {
    const r = await chargeOrder(deps({ markPaid: async () => false }), "ord-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("OK123");
  });
});
