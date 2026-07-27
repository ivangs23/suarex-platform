import { describe, expect, it, vi } from "vitest";
import type { ChargeEvent } from "./charge-journal.js";
import { type ChargeOrderDeps, chargeOrder } from "./kiosko.js";
import type { ResolvedPaymentConfig } from "./payment-provider.js";

const CONFIG: ResolvedPaymentConfig = {
  provider: "paytef",
  values: { accessKey: "AK", secretKey: "SK", companyId: "1", pinpad: "PIN" },
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

/**
 * EL ORDEN de lo que se apunta en el diario, que es lo único que hace recuperable un tirón del
 * enchufe. No se comprueba "que se llame al diario" sino CUÁNDO: apuntar el cobro después de
 * cobrarlo dejaría el mismo agujero que no apuntarlo.
 */
describe("chargeOrder y el diario de cobros", () => {
  /** Devuelve los eventos apuntados, y de paso registra en qué momento pasó cada cosa. */
  function conDiario(over: Partial<ChargeOrderDeps> = {}) {
    const orden: string[] = [];
    const eventos: ChargeEvent[] = [];
    const base = deps({
      charge: async (_c, _a, _r, opts) => {
        orden.push("cobra");
        await opts.onSession?.("S-1");
        return { approved: true as const, authCode: "OK123" };
      },
      markPaid: async () => {
        orden.push("marca");
        return true;
      },
      ...over,
    });
    return {
      orden,
      eventos,
      deps: {
        ...base,
        journal: async (event: ChargeEvent) => {
          orden.push(`diario:${event.t}`);
          eventos.push(event);
        },
      } satisfies ChargeOrderDeps,
    };
  }

  it("apunta el cobro ANTES de hablar con el datáfono, y el aprobado ANTES de registrarlo", async () => {
    const caso = conDiario();
    await chargeOrder(caso.deps, "ord-1", { now: () => 42 });

    expect(caso.orden).toEqual([
      "diario:started", // primero el disco...
      "cobra", // ...y solo entonces el dinero
      "diario:session",
      "diario:approved", // aprobado en disco...
      "marca", // ...antes de intentar registrarlo
      "diario:settled",
    ]);
  });

  it("todos los eventos comparten la referencia de la operación", async () => {
    const caso = conDiario();
    await chargeOrder(caso.deps, "ord-1", { now: () => 42 });
    expect(new Set(caso.eventos.map((e) => e.ref))).toEqual(new Set(["ORD-ord-1-42"]));
  });

  it("apunta el importe y el pedido: sin ellos, un cobro recuperado no se sabe de quién es", async () => {
    const caso = conDiario();
    await chargeOrder(caso.deps, "ord-1", { now: () => 42 });
    expect(caso.eventos[0]).toMatchObject({ t: "started", orderId: "ord-1", amountCents: 1250 });
  });

  it("guarda la sesión del datáfono: es lo que permite volver a preguntarle tras un corte", async () => {
    const caso = conDiario();
    await chargeOrder(caso.deps, "ord-1", { now: () => 42 });
    expect(caso.eventos.find((e) => e.t === "session")).toMatchObject({ sessionId: "S-1" });
  });

  it("un cobro denegado se cierra en el diario: no hay nada que recuperar al arrancar", async () => {
    const caso = conDiario({
      charge: async () => ({ approved: false as const, reason: "Fondos insuficientes" }),
    });
    await chargeOrder(caso.deps, "ord-1", { now: () => 42 });

    expect(caso.eventos.map((e) => e.t)).toEqual(["started", "declined"]);
  });

  it("aprobado y sin registrar NO se cierra: es justo lo que hay que recuperar", async () => {
    const caso = conDiario({ markPaid: async () => false });
    const r = await chargeOrder(caso.deps, "ord-1", { now: () => 42, sleep: async () => {} });

    expect(r.status).toBe("in-doubt");
    expect(caso.eventos.map((e) => e.t)).toEqual(["started", "session", "approved"]);
    expect(caso.eventos.some((e) => e.t === "settled")).toBe(false);
  });

  it("sin diario, el cobro funciona igual: es una garantía añadida, no un requisito", async () => {
    const r = await chargeOrder(deps(), "ord-1", { now: () => 42 });
    expect(r).toEqual({ status: "paid", authCode: "OK123" });
  });
});
