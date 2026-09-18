import { tenantsTableForBilling } from "./client.js";
import type { PlanStatus } from "./types.js";

/** Días que se sigue sirviendo a un tenant que ha dejado de pagar. Ver decisión D2 del spec de
 *  la Fase 1: el corte inmediato es técnicamente más simple y comercialmente ruinoso. */
export const DIAS_DE_GRACIA = 7;

export type DecisionServicio = {
  status: "active" | "suspended";
  graceUntil: Date | null;
};

/**
 * ÚNICA fuente de verdad sobre si un tenant se sirve o se corta.
 *
 * Pura a propósito: la política de impagos es la parte de este bloque que más se va a discutir
 * y cambiar, así que vive donde se puede probar exhaustivamente sin Stripe, sin red y sin base
 * de datos.
 *
 * `graceUntil` ENTRA y SALE, y eso es lo que hace que la ventana funcione:
 * - Una ventana ya abierta NO se reinicia con cada reintento fallido de Stripe. Si lo hiciera,
 *   no vencería nunca y el corte no existiría en la práctica.
 * - Se cierra en cuanto el tenant vuelve a estar al corriente. Si no, arrastraría su
 *   `grace_until` y el barrido diario lo suspendería igualmente al vencer, ya pagando.
 */
export function decidirEstado(
  planStatus: PlanStatus,
  ahora: Date,
  graceUntil: Date | null,
): DecisionServicio {
  if (planStatus === "canceled") return { status: "suspended", graceUntil: null };
  if (planStatus === "trialing" || planStatus === "active") {
    return { status: "active", graceUntil: null };
  }

  // past_due
  const ventana = graceUntil ?? new Date(ahora.getTime() + DIAS_DE_GRACIA * 86400_000);
  return { status: ventana > ahora ? "active" : "suspended", graceUntil: ventana };
}

export type ApplyOutcome = "aplicado" | "tenant-no-encontrado";

/**
 * Aplica a la base el estado que Stripe acaba de comunicar.
 *
 * El tenant se localiza por `stripe_customer_id` porque es el único identificador que Stripe
 * conoce: sus webhooks no saben nada de tenants. Esa columna tiene índice único parcial
 * (`20260915000002`), así que `.maybeSingle()` no puede reventar por duplicados.
 */
export async function applySubscriptionState(
  stripeCustomerId: string,
  planStatus: PlanStatus,
  subscriptionId: string | null,
): Promise<ApplyOutcome> {
  const { data: tenant, error: leer } = await tenantsTableForBilling()
    .select("id, grace_until")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  if (leer) throw leer;
  if (!tenant) return "tenant-no-encontrado";

  const fila = tenant as { id: string; grace_until: string | null };
  const decision = decidirEstado(
    planStatus,
    new Date(),
    fila.grace_until ? new Date(fila.grace_until) : null,
  );

  const { error } = await tenantsTableForBilling()
    .update({
      plan_status: planStatus,
      status: decision.status,
      grace_until: decision.graceUntil?.toISOString() ?? null,
      ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
    })
    .eq("id", fila.id);
  if (error) throw error;

  return "aplicado";
}

/**
 * Cierra las ventanas de gracia vencidas y devuelve cuántas.
 *
 * Lo dispara el cron diario porque nadie vuelve a llamar cuando la ventana vence: Stripe no
 * manda un evento "han pasado siete días". El webhook abre; esto cierra.
 */
export async function suspendExpiredGrace(): Promise<number> {
  const { data, error } = await tenantsTableForBilling()
    .update({ status: "suspended" })
    .eq("status", "active")
    .lt("grace_until", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return (data as unknown[] | null)?.length ?? 0;
}
