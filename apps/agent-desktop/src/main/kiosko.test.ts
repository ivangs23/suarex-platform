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
    expect(r).toEqual({ status: "paid", authCode: "OK123" });
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
    expect(r).toEqual({ status: "declined", reason: "Denegada" });
    expect(markPaid).not.toHaveBeenCalled();
  });

  it("pedido ya pagado: idempotente, no vuelve a cobrar", async () => {
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "X" }));
    const r = await chargeOrder(
      deps({ readOrder: async () => ({ amountCents: 500, status: "paid" }), charge }),
      "ord-1",
    );
    expect(r.status).toBe("paid");
    expect(charge).not.toHaveBeenCalled();
  });

  it("pedido no encontrado: falla sin cobrar", async () => {
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "X" }));
    const r = await chargeOrder(deps({ readOrder: async () => null, charge }), "ord-1");
    expect(r).toEqual({ status: "declined", reason: "Pedido no encontrado" });
    expect(charge).not.toHaveBeenCalled();
  });

  it("sin config de datáfono: falla sin cobrar", async () => {
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "X" }));
    const r = await chargeOrder(deps({ getConfig: async () => null, charge }), "ord-1");
    expect(r.status).toBe("declined");
    expect(charge).not.toHaveBeenCalled();
  });

  it("si el marcado falla una vez, reintenta y acaba cobrando bien", async () => {
    // Un corte de red de unos segundos no debe convertirse en un cobro sin pedido.
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "OK123" }));
    let intentos = 0;
    const markPaid = vi.fn(async () => {
      intentos += 1;
      return intentos >= 3;
    });
    const r = await chargeOrder(deps({ charge, markPaid }), "ord-1", { sleep: async () => {} });
    expect(r).toEqual({ status: "paid", authCode: "OK123" });
    expect(markPaid).toHaveBeenCalledTimes(3);
    // Lo que NUNCA se repite es el cobro.
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it("aprobado y sin poder registrarlo: queda EN DUDA, nunca 'denegado'", async () => {
    // Es el caso que produce clientes cobrados sin comida. Tiene que distinguirse de un rechazo,
    // porque un rechazo invita a reintentar -- y aquí reintentar sería cobrar dos veces.
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "OK123" }));
    const r = await chargeOrder(deps({ charge, markPaid: async () => false }), "ord-1", {
      sleep: async () => {},
    });
    expect(r.status).toBe("in-doubt");
    // El código de autorización sobrevive: es lo que permite casarlo con el cierre del datáfono.
    if (r.status === "in-doubt") expect(r.authCode).toBe("OK123");
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it("si el marcado revienta (no solo devuelve false), tampoco se re-cobra", async () => {
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "OK123" }));
    const markPaid = vi.fn(async () => {
      throw new Error("red caída");
    });
    const r = await chargeOrder(deps({ charge, markPaid }), "ord-1", { sleep: async () => {} });
    expect(r.status).toBe("in-doubt");
    expect(charge).toHaveBeenCalledTimes(1);
  });
});
