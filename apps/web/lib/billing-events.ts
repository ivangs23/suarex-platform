import type { PlanStatus } from "@suarex/db";

/**
 * Traduce el estado de una suscripción de Stripe al estado de plan de este sistema.
 *
 * Devuelve `null` para todo lo que NO debe cambiar el servicio. Esa es la parte importante:
 * el conjunto de estados de Stripe crece con el tiempo (hoy son ocho), y el valor por defecto
 * ante uno desconocido tiene que ser "no toques nada". Adivinar aquí significa cortarle la
 * carta a un restaurante por un valor que nadie ha leído todavía.
 *
 * Vive fuera del route handler para poder probarlo sin levantar un servidor Next: es la única
 * parte del webhook que decide algo.
 */
const ESTADOS: Record<string, PlanStatus> = {
  trialing: "trialing",
  active: "active",
  past_due: "past_due",
  // Stripe pasa a `unpaid` cuando agota los reintentos de cobro. Es un impago, no una baja:
  // tratarlo como `canceled` cortaría sin ventana de gracia a quien solo tiene la tarjeta
  // caducada.
  unpaid: "past_due",
  canceled: "canceled",
  // Un alta que nunca confirmó la tarjeta y ya expiró: no hay suscripción que servir.
  incomplete_expired: "canceled",
  // NO se mapean, a propósito:
  // - `incomplete`: el alta está a medio confirmar la tarjeta. Aún no ha pasado nada que
  //   cambie el servicio, y tratarlo como impago cortaría a un cliente que está justo
  //   terminando de darse de alta.
  // - `paused`: la facturación está pausada de acuerdo con el cliente. No es un fallo de cobro.
};

export function planStatusDeStripe(status: string): PlanStatus | null {
  return ESTADOS[status] ?? null;
}
