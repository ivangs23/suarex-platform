import { describe, expect, it, vi } from "vitest";
import type { PendingCharge } from "./charge-journal.js";
import type { RecoveryDeps, SessionOutcome } from "./charge-recovery.js";
import { recoverCharge, recoverCharges } from "./charge-recovery.js";

const cobro = (over: Partial<PendingCharge> = {}): PendingCharge => ({
  ref: "ORD-1-1000",
  orderId: "o1",
  amountCents: 1200,
  startedAt: 1000,
  ...over,
});

function deps(over: Partial<RecoveryDeps> = {}): RecoveryDeps {
  return {
    orderStatus: async () => "pending",
    markPaid: async () => true,
    pollSession: async (): Promise<SessionOutcome> => ({ kind: "unknown" }),
    onSettled: async () => {},
    onApproved: async () => {},
    ...over,
  };
}

describe("recoverCharge", () => {
  it("si el pedido ya consta pagado, se cierra sin molestar a nadie", async () => {
    // El marcado SÍ llegó; lo que se perdió fue la respuesta. Avisar aquí sería avisar de un
    // problema que no existe, que es la forma más rápida de que dejen de leerse los avisos.
    const onSettled = vi.fn(async () => {});
    const markPaid = vi.fn(async () => true);
    const resultado = await recoverCharge(
      deps({ orderStatus: async () => "paid", onSettled, markPaid }),
      cobro({ authCode: "AUTH-1" }),
    );

    expect(resultado.kind).toBe("settled");
    expect(onSettled).toHaveBeenCalledOnce();
    expect(markPaid, "no hacía falta volver a marcar un pedido ya pagado").not.toHaveBeenCalled();
  });

  it("con el cobro aprobado y sin registrar, lo registra y queda cerrado", async () => {
    const markPaid = vi.fn(async () => true);
    const resultado = await recoverCharge(deps({ markPaid }), cobro({ authCode: "AUTH-1" }));

    expect(markPaid).toHaveBeenCalledWith("o1");
    expect(resultado.kind).toBe("settled");
    expect(resultado.authCode).toBe("AUTH-1");
  });

  it("aprobado pero sin poder registrarlo: avisa CON el código de autorización", async () => {
    // Es dinero cobrado. El código es lo único que permite casarlo con el cierre del datáfono,
    // así que no puede perderse en un mensaje genérico.
    const onSettled = vi.fn(async () => {});
    const resultado = await recoverCharge(
      deps({ markPaid: async () => false, onSettled }),
      cobro({ authCode: "AUTH-7" }),
    );

    expect(resultado.kind).toBe("needs-staff");
    expect(resultado.authCode).toBe("AUTH-7");
    expect(onSettled, "un cobro sin registrar NO puede darse por cerrado").not.toHaveBeenCalled();
  });

  it("un markPaid que revienta se trata como no registrado, no tumba la recuperación", async () => {
    const resultado = await recoverCharge(
      deps({
        markPaid: async () => {
          throw new Error("sin red");
        },
      }),
      cobro({ authCode: "AUTH-7" }),
    );
    expect(resultado.kind).toBe("needs-staff");
  });

  it("sin desenlace pero con sesión, le pregunta al datáfono: si aprobó, lo registra", async () => {
    const onApproved = vi.fn(async () => {});
    const markPaid = vi.fn(async () => true);
    const resultado = await recoverCharge(
      deps({
        pollSession: async () => ({ kind: "approved", authCode: "AUTH-9" }),
        onApproved,
        markPaid,
      }),
      cobro({ sessionId: "S-1" }),
    );

    // Al diario ANTES de registrar: un segundo corte no puede volver a dejarlo sin rastro.
    expect(onApproved).toHaveBeenCalledOnce();
    expect(markPaid).toHaveBeenCalledWith("o1");
    expect(resultado).toMatchObject({ kind: "settled", authCode: "AUTH-9" });
  });

  it("si el datáfono dice que se denegó, se cierra: no se movió un céntimo", async () => {
    const onSettled = vi.fn(async () => {});
    const resultado = await recoverCharge(
      deps({ pollSession: async () => ({ kind: "declined", reason: "Fondos" }), onSettled }),
      cobro({ sessionId: "S-1" }),
    );

    expect(resultado.kind).toBe("settled");
    expect(resultado.detail).toContain("Fondos");
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("si el datáfono no sabe decirlo, se avisa en vez de cerrar por si acaso", async () => {
    const onSettled = vi.fn(async () => {});
    const resultado = await recoverCharge(
      deps({ pollSession: async () => ({ kind: "unknown" }), onSettled }),
      cobro({ sessionId: "S-1" }),
    );

    expect(resultado.kind).toBe("needs-staff");
    expect(resultado.detail).toContain("datáfono");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("una consulta que revienta cuenta como 'no se sabe', nunca como 'no se cobró'", async () => {
    const resultado = await recoverCharge(
      deps({
        pollSession: async () => {
          throw new Error("sin red");
        },
      }),
      cobro({ sessionId: "S-1" }),
    );
    expect(resultado.kind).toBe("needs-staff");
  });

  it("sin sesión ni desenlace se avisa: la ventana es mínima, pero cerrarla en silencio no vale", async () => {
    const resultado = await recoverCharge(deps(), cobro());
    expect(resultado.kind).toBe("needs-staff");
  });

  it("el pedido ya no existe y el cliente había pagado: eso lo tiene que ver una persona", async () => {
    const onSettled = vi.fn(async () => {});
    const resultado = await recoverCharge(
      deps({ orderStatus: async () => "missing", onSettled }),
      cobro({ authCode: "AUTH-3" }),
    );

    expect(resultado.kind).toBe("needs-staff");
    expect(resultado.authCode).toBe("AUTH-3");
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("el pedido ya no existe y no llegó a cobrarse: no hay nada que resolver", async () => {
    const resultado = await recoverCharge(
      deps({ orderStatus: async () => "missing" }),
      cobro({ sessionId: "S-1" }),
    );
    expect(resultado.kind).toBe("settled");
  });

  it("si ni siquiera se puede consultar el pedido, se sigue por el resto de pistas", async () => {
    // Sin red al arrancar: no se puede preguntar por el pedido, pero sí registrar más tarde.
    // Lo que NO puede pasar es que un fallo de lectura cierre el cobro.
    const resultado = await recoverCharge(
      deps({
        orderStatus: async () => {
          throw new Error("sin red");
        },
        markPaid: async () => false,
      }),
      cobro({ authCode: "AUTH-1" }),
    );
    expect(resultado.kind).toBe("needs-staff");
    expect(resultado.authCode).toBe("AUTH-1");
  });
});

describe("recoverCharges", () => {
  it("recupera todos y devuelve un desenlace por cobro", async () => {
    const resultados = await recoverCharges(deps({ orderStatus: async () => "paid" }), [
      cobro({ ref: "r1", orderId: "o1" }),
      cobro({ ref: "r2", orderId: "o2" }),
    ]);
    expect(resultados.map((r) => r.ref)).toEqual(["r1", "r2"]);
    expect(resultados.every((r) => r.kind === "settled")).toBe(true);
  });

  it("de uno en uno: el datáfono atiende una operación a la vez", async () => {
    const orden: string[] = [];
    const pollSession = vi.fn(async (sessionId: string): Promise<SessionOutcome> => {
      orden.push(`empieza:${sessionId}`);
      await new Promise((r) => setTimeout(r, 5));
      orden.push(`acaba:${sessionId}`);
      return { kind: "unknown" };
    });

    await recoverCharges(deps({ pollSession }), [
      cobro({ ref: "r1", sessionId: "S-1" }),
      cobro({ ref: "r2", sessionId: "S-2" }),
    ]);

    expect(orden).toEqual(["empieza:S-1", "acaba:S-1", "empieza:S-2", "acaba:S-2"]);
  });

  it("sin nada a medias no hace nada", async () => {
    expect(await recoverCharges(deps(), [])).toEqual([]);
  });
});
