import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChargeJournal } from "./charge-journal.js";
import type { RecoveryDeps, RecoveryOutcome, SessionOutcome } from "./charge-recovery.js";
import { recoverCharges } from "./charge-recovery.js";
import { chargeOrder } from "./kiosko.js";
import type { PaytefBridgeConfig } from "./paytef.js";

/**
 * EL CASO QUE MOTIVA TODO ESTO, de punta a punta y con ficheros de verdad: el totem se apaga
 * justo después de que el datáfono apruebe, y al arrancar de nuevo el cobro tiene que aparecer.
 *
 * Los tests de cada pieza por separado ya cubren sus ramas; este comprueba que ENCAJAN -- que lo
 * que `chargeOrder` escribe es exactamente lo que la recuperación sabe leer. Es donde se
 * detectaría que el diario guarda una cosa y el reconciliador espera otra, que es el fallo que
 * ninguna de las dos suites vería por su cuenta.
 */

const CONFIG: PaytefBridgeConfig = {
  accessKey: "AK",
  secretKey: "SK",
  companyId: "1",
  pinpad: "PIN",
  mock: false,
};

/** El corte durante la operación del datáfono: `chargeOrder` no envuelve `charge`, así que esto
 *  sale hacia arriba igual que saldría un proceso que se va. */
class ApagonSimulado extends Error {}

function recoveryDeps(over: Partial<RecoveryDeps> = {}): RecoveryDeps {
  return {
    orderStatus: async () => "pending",
    markPaid: async () => true,
    pollSession: async (): Promise<SessionOutcome> => ({ kind: "unknown" }),
    onSettled: async () => {},
    onApproved: async () => {},
    ...over,
  };
}

describe("cobro interrumpido y recuperado (diario real en disco)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cobro-e2e-"));
  });

  /**
   * Deja el diario tal y como queda cuando el cobro se aprueba y NO llega a registrarse.
   *
   * No hace falta matar el proceso de verdad para reproducirlo: lo que la recuperación va a leer
   * es un fichero, y ese fichero queda idéntico tanto si se fue la luz tras el `approved` como
   * si el registro falló cuatro veces seguidas. Se usa lo segundo, que sí se puede provocar.
   */
  async function diarioTrasAprobarSinRegistrar() {
    const journal = createChargeJournal(dir);
    const resultado = await chargeOrder(
      {
        readOrder: async () => ({ amountCents: 1250, status: "pending" }),
        getConfig: async () => CONFIG,
        charge: async (_c, _a, _r, opts) => {
          await opts.onSession?.("S-42");
          return { approved: true as const, authCode: "AUTH-77" };
        },
        markPaid: async () => false,
        journal: (event) => journal.append(event),
      },
      "ord-9",
      { now: () => 1000, sleep: async () => {} },
    );
    expect(resultado.status).toBe("in-doubt");

    // Nueva instancia del diario: exactamente lo que hace el arranque siguiente.
    return createChargeJournal(dir);
  }

  /** El otro corte, este sí una muerte de verdad: el proceso se va DURANTE la operación. */
  async function diarioTrasCorteEnElDatafono() {
    const journal = createChargeJournal(dir);
    await expect(
      chargeOrder(
        {
          readOrder: async () => ({ amountCents: 1250, status: "pending" }),
          getConfig: async () => CONFIG,
          charge: async (_c, _a, _r, opts) => {
            await opts.onSession?.("S-42");
            throw new ApagonSimulado();
          },
          markPaid: async () => true,
          journal: (event) => journal.append(event),
        },
        "ord-9",
        { now: () => 1000, sleep: async () => {} },
      ),
    ).rejects.toBeInstanceOf(ApagonSimulado);

    return createChargeJournal(dir);
  }

  it("aprobado y sin registrar: el arranque siguiente registra el pedido solo", async () => {
    const journal = await diarioTrasAprobarSinRegistrar();

    const pendientes = await journal.pending();
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({
      orderId: "ord-9",
      amountCents: 1250,
      authCode: "AUTH-77",
    });

    const markPaid = vi.fn(async () => true);
    const resultados = await recoverCharges(
      recoveryDeps({
        markPaid,
        onSettled: (charge) => journal.append({ t: "settled", ref: charge.ref, at: 2000 }),
      }),
      pendientes,
    );

    expect(markPaid).toHaveBeenCalledWith("ord-9");
    expect(resultados[0]).toMatchObject({ kind: "settled", authCode: "AUTH-77" });
    // Y no vuelve a aparecer en el arranque de después: cerrado es cerrado.
    expect(await createChargeJournal(dir).pending()).toEqual([]);
  });

  it("aprobado y sin poder registrar tampoco al arrancar: avisa con el importe y el código", async () => {
    const journal = await diarioTrasAprobarSinRegistrar();
    const avisos: RecoveryOutcome[] = [];

    const resultados = await recoverCharges(
      recoveryDeps({ markPaid: async () => false }),
      await journal.pending(),
    );
    avisos.push(...resultados.filter((r) => r.kind === "needs-staff"));

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ orderId: "ord-9", amountCents: 1250, authCode: "AUTH-77" });
    // Sigue pendiente: mientras nadie lo resuelva, el siguiente arranque vuelve a avisar.
    expect(await createChargeJournal(dir).pending()).toHaveLength(1);
  });

  it("muerto DURANTE el cobro: se le pregunta al datáfono por la sesión y se resuelve", async () => {
    // El peor caso: ni siquiera se sabe si el cliente pagó. La sesión apuntada es lo único que
    // permite averiguarlo en vez de tener que ir al cierre del datáfono a mano.
    const journal = await diarioTrasCorteEnElDatafono();

    const pendientes = await journal.pending();
    expect(pendientes[0]).toMatchObject({ sessionId: "S-42" });
    expect(pendientes[0]?.authCode).toBeUndefined();

    const markPaid = vi.fn(async () => true);
    const resultados = await recoverCharges(
      recoveryDeps({
        pollSession: async (sessionId) => {
          expect(sessionId).toBe("S-42");
          return { kind: "approved", authCode: "AUTH-88" };
        },
        markPaid,
        onApproved: (charge, authCode) =>
          journal.append({ t: "approved", ref: charge.ref, authCode, at: 2000 }),
        onSettled: (charge) => journal.append({ t: "settled", ref: charge.ref, at: 2001 }),
      }),
      pendientes,
    );

    expect(markPaid).toHaveBeenCalledWith("ord-9");
    expect(resultados[0]).toMatchObject({ kind: "settled", authCode: "AUTH-88" });
    expect(await createChargeJournal(dir).pending()).toEqual([]);
  });

  it("un cobro que acaba bien no deja nada que recuperar", async () => {
    const journal = createChargeJournal(dir);
    await chargeOrder(
      {
        readOrder: async () => ({ amountCents: 1250, status: "pending" }),
        getConfig: async () => CONFIG,
        charge: async (_c, _a, _r, opts) => {
          await opts.onSession?.("S-1");
          return { approved: true as const, authCode: "AUTH-1" };
        },
        markPaid: async () => true,
        journal: (event) => journal.append(event),
      },
      "ord-1",
      { now: () => 1000 },
    );

    expect(await createChargeJournal(dir).pending()).toEqual([]);
  });

  it("un cobro denegado tampoco deja nada: no se movió un céntimo", async () => {
    const journal = createChargeJournal(dir);
    await chargeOrder(
      {
        readOrder: async () => ({ amountCents: 1250, status: "pending" }),
        getConfig: async () => CONFIG,
        charge: async () => ({ approved: false as const, reason: "Fondos insuficientes" }),
        markPaid: async () => true,
        journal: (event) => journal.append(event),
      },
      "ord-1",
      { now: () => 1000 },
    );

    expect(await createChargeJournal(dir).pending()).toEqual([]);
  });
});
