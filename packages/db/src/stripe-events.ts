import { stripeEventsTableForRetention, stripeEventsTableForWebhook } from "./client.js";

/**
 * Eventos de Stripe ya procesados (ver `20261022000001_stripe_events.sql`).
 *
 * El orden en las rutas es: comprobar, procesar, y registrar SOLO si todo fue bien. Registrar
 * antes perdería cobros: si el proceso falla a medias, Stripe reintenta y el reintento se
 * descartaría como duplicado de algo que nunca terminó. Dos entregas simultáneas del mismo evento
 * pueden procesarse las dos, y no pasa nada: los manejadores son idempotentes por sí mismos.
 */

export async function stripeEventYaProcesado(eventId: string): Promise<boolean> {
  const { data, error } = await stripeEventsTableForWebhook()
    .select("id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Registra un evento procesado. `duplicate` si otra entrega simultánea lo registró antes. */
export async function recordStripeEvent(
  event: { id: string; type: string },
  tenantId: string | null,
): Promise<"new" | "duplicate"> {
  const { data, error } = await stripeEventsTableForWebhook()
    .upsert(
      { id: event.id, type: event.type, tenant_id: tenantId },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  return data.length > 0 ? "new" : "duplicate";
}

/** Borra los eventos de más de `dias` días. Devuelve cuántos. */
export async function purgeStripeEvents(dias = 90): Promise<number> {
  const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await stripeEventsTableForRetention()
    .delete()
    .lt("received_at", limite)
    .select("id");
  if (error) throw error;
  return data.length;
}
