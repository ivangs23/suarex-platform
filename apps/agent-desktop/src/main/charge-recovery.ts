import type { PendingCharge } from "./charge-journal.js";

/**
 * QUÉ HACER AL ARRANCAR con los cobros que el diario dejó a medias.
 *
 * Un totem que se apaga a mitad de un pago vuelve sin memoria: el cliente puede haber pagado, el
 * pedido sigue `pending`, y hasta ahora nadie se enteraba. Esta función es lo que convierte ese
 * silencio en una de dos cosas: o el pedido queda registrado solo, o alguien del local recibe un
 * aviso con el código de autorización en la mano.
 *
 * PURA respecto al mundo: todo lo que toca red, disco o datáfono entra por `deps`, así que cada
 * rama -- que es donde se decide si un cliente se queda sin comida -- se prueba entera sin
 * levantar nada.
 *
 * El principio que ordena las ramas: NUNCA cerrar un cobro sobre el que quede duda. Cerrar de más
 * es perder dinero de un cliente que pagó; avisar de más es que alguien mire el cierre del
 * datáfono y no encuentre nada. Lo segundo se arregla en un minuto; lo primero no se arregla.
 */

export type SessionOutcome =
  | { kind: "approved"; authCode: string }
  | { kind: "declined"; reason: string }
  /** El datáfono no sabe decirlo (sesión caducada, sin red, mock…). */
  | { kind: "unknown" };

export type RecoveryDeps = {
  /** Estado del pedido en el SERVIDOR, que es la verdad. `missing` si ya no existe. */
  orderStatus: (orderId: string) => Promise<"paid" | "pending" | "other" | "missing">;
  /** Marca el pedido pagado (misma RPC acotada que usa el cobro normal). */
  markPaid: (orderId: string) => Promise<boolean>;
  /** Vuelve a preguntar al datáfono por una sesión concreta. */
  pollSession: (sessionId: string) => Promise<SessionOutcome>;
  /** Se llama por cada cobro que queda cerrado, para apuntarlo en el diario. */
  onSettled: (charge: PendingCharge) => Promise<void>;
  /** Se llama cuando se descubre que un cobro SÍ aprobó y no constaba: hay que apuntarlo antes
   *  de intentar registrarlo, o un segundo corte volvería a dejarlo sin rastro. */
  onApproved: (charge: PendingCharge, authCode: string) => Promise<void>;
};

export type RecoveryOutcome = {
  ref: string;
  orderId: string;
  amountCents: number;
  /**
   * `settled` -- resuelto solo, no hace falta nadie.
   * `needs-staff` -- queda duda o dinero cobrado sin registrar; alguien tiene que mirarlo.
   */
  kind: "settled" | "needs-staff";
  /** En claro y en español: es lo que va a leer quien abra el local por la mañana. */
  detail: string;
  /** Presente cuando se sabe que el cliente pagó: es lo que casa con el cierre del datáfono. */
  authCode?: string;
};

/** Registra el cobro y decide si con eso queda cerrado o hay que avisar. */
async function registra(
  deps: RecoveryDeps,
  charge: PendingCharge,
  authCode: string,
): Promise<RecoveryOutcome> {
  const base = { ref: charge.ref, orderId: charge.orderId, amountCents: charge.amountCents };
  const marcado = await deps.markPaid(charge.orderId).catch(() => false);
  if (marcado) {
    await deps.onSettled(charge);
    return { ...base, kind: "settled", detail: "Cobro recuperado y pedido registrado", authCode };
  }
  return {
    ...base,
    kind: "needs-staff",
    detail: "El cliente pagó pero no se ha podido registrar el pedido",
    authCode,
  };
}

export async function recoverCharge(
  deps: RecoveryDeps,
  charge: PendingCharge,
): Promise<RecoveryOutcome> {
  const base = { ref: charge.ref, orderId: charge.orderId, amountCents: charge.amountCents };

  /* Lo primero, el servidor: puede que el marcado SÍ llegara y lo que se perdiera fuera solo la
     respuesta. Sin esta comprobación, recuperar volvería a marcar un pedido ya pagado -- inocuo
     por idempotencia, pero también avisaría al personal de un problema que no existe. */
  const estado = await deps.orderStatus(charge.orderId).catch(() => "other" as const);
  if (estado === "paid") {
    await deps.onSettled(charge);
    return { ...base, kind: "settled", detail: "El pedido ya constaba pagado" };
  }
  if (estado === "missing") {
    // El pedido ya no existe (caducó y se limpió, o lo borraron). Si sabemos que el cliente pagó,
    // eso es dinero cobrado sin pedido al que atarlo: es exactamente lo que una persona tiene que
    // resolver. Si no llegó a pagar, no hay nada que hacer.
    if (charge.authCode) {
      return {
        ...base,
        kind: "needs-staff",
        detail: "El cliente pagó pero el pedido ya no existe",
        authCode: charge.authCode,
      };
    }
    await deps.onSettled(charge);
    return { ...base, kind: "settled", detail: "El pedido ya no existe y no llegó a cobrarse" };
  }

  // Ya sabíamos que aprobó: solo faltaba registrarlo.
  if (charge.authCode) return registra(deps, charge, charge.authCode);

  // No sabemos cómo acabó, pero tenemos la sesión: se le pregunta al datáfono.
  if (charge.sessionId) {
    const desenlace = await deps
      .pollSession(charge.sessionId)
      .catch((): SessionOutcome => ({ kind: "unknown" }));

    if (desenlace.kind === "approved") {
      // Al diario ANTES de registrar: si el proceso vuelve a morir aquí, el siguiente arranque ya
      // sabe que el cliente pagó y no depende de que la sesión siga viva en el datáfono.
      await deps.onApproved(charge, desenlace.authCode);
      return registra(deps, { ...charge, authCode: desenlace.authCode }, desenlace.authCode);
    }
    if (desenlace.kind === "declined") {
      await deps.onSettled(charge);
      return { ...base, kind: "settled", detail: `No se llegó a cobrar: ${desenlace.reason}` };
    }
    return {
      ...base,
      kind: "needs-staff",
      detail: "No se ha podido saber si el cobro llegó a hacerse: revisa el cierre del datáfono",
    };
  }

  /* Ni desenlace ni sesión: el proceso murió entre apuntar el cobro y que el datáfono aceptara la
     orden. La ventana es de milisegundos y lo más probable es que no se cobrara nada, pero
     "probable" no basta cuando la alternativa es cerrar en silencio un cobro real. */
  return {
    ...base,
    kind: "needs-staff",
    detail: "El cobro se interrumpió antes de saber nada: revisa el cierre del datáfono",
  };
}

/**
 * Recupera TODOS los cobros a medias, en orden y de uno en uno.
 *
 * En serie y no en paralelo a propósito: cada rama habla con el datáfono, que atiende una
 * operación a la vez, y ganar un segundo al arrancar no vale lo que cuesta enredar eso.
 */
export async function recoverCharges(
  deps: RecoveryDeps,
  pending: PendingCharge[],
): Promise<RecoveryOutcome[]> {
  const resultados: RecoveryOutcome[] = [];
  for (const charge of pending) {
    resultados.push(await recoverCharge(deps, charge));
  }
  return resultados;
}
