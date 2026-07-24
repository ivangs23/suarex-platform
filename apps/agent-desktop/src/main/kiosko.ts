import type { PaytefBridgeConfig, PaytefResult, PaytefStatus } from "./paytef.js";

// Orquestación del cobro de un pedido del totem: leer el importe (del SERVIDOR), resolver la
// config del datáfono, cobrar por Paytef y, si aprueba, marcar el pedido pagado. Las
// dependencias se inyectan para probar la lógica sin Electron, red, ni base de datos.

export type ChargeOrderDeps = {
  /** Lee el pedido kiosko con el JWT del device: importe (céntimos, de la base) y estado. */
  readOrder: (orderId: string) => Promise<{ amountCents: number; status: string } | null>;
  /** Resuelve la config Paytef del totem (cuenta del tenant + pinpad). `null` si no hay. */
  getConfig: () => Promise<PaytefBridgeConfig | null>;
  /** Cobra por Paytef (o mock). */
  charge: (
    config: PaytefBridgeConfig,
    amountCents: number,
    transactionReference: string,
    opts: { onStatus?: (s: PaytefStatus, m: string) => void; isCancelled?: () => boolean },
  ) => Promise<PaytefResult>;
  /** Marca el pedido pagado tras aprobar (RPC acotada). `true` si marcó. */
  markPaid: (orderId: string) => Promise<boolean>;
};

export type ChargeOrderResult = { ok: true; authCode: string } | { ok: false; reason: string };

/**
 * Cobra un pedido del totem de principio a fin. El importe SIEMPRE sale de `readOrder` (la base),
 * nunca del renderer, para que un XSS en la carta no pueda cobrar un importe arbitrario.
 * Idempotente ante un pedido ya pagado (no re-cobra).
 */
export async function chargeOrder(
  deps: ChargeOrderDeps,
  orderId: string,
  opts: {
    onStatus?: (s: PaytefStatus, m: string) => void;
    isCancelled?: () => boolean;
    now?: () => number;
  } = {},
): Promise<ChargeOrderResult> {
  const order = await deps.readOrder(orderId);
  if (!order) return { ok: false, reason: "Pedido no encontrado" };
  // Ya pagado: idempotente, no se vuelve a cobrar (p. ej. un reintento tras un corte de red).
  if (order.status === "paid") return { ok: true, authCode: "" };
  if (order.status !== "pending") {
    return { ok: false, reason: "El pedido no está pendiente de pago" };
  }

  const config = await deps.getConfig();
  if (!config) return { ok: false, reason: "El terminal de pago no está configurado" };

  const now = opts.now ?? (() => Date.now());
  const reference = `ORD-${orderId}-${now()}`;
  const result = await deps.charge(config, order.amountCents, reference, {
    onStatus: opts.onStatus,
    isCancelled: opts.isCancelled,
  });
  if (!result.approved) return { ok: false, reason: result.reason };

  const marked = await deps.markPaid(orderId);
  if (!marked) {
    // Cobro aprobado pero no se pudo registrar el pago: estado delicado (dinero cobrado, pedido
    // aún pending). Se devuelve el authCode para no perderlo; un reintento NO debe re-cobrar a
    // ciegas -- por eso el guard de "ya pagado" de arriba, y por eso conviene reintentar solo el
    // marcado, no el cobro. (Reintento del marcado: pendiente de endurecer en fase de cierre.)
    return { ok: false, reason: `Pago aprobado (${result.authCode}) pero no se pudo registrar` };
  }
  return { ok: true, authCode: result.authCode };
}
