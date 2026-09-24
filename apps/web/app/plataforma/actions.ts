"use server";

import { resolveRootDomains } from "@suarex/config";
import {
  createTenantWithOwner,
  getTenantStripeCustomer,
  setTenantStatus,
  setTenantStripeCustomer,
} from "@suarex/db";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";
import { parseNuevoCliente } from "@/lib/platform-action-input";
import { platformAction } from "@/lib/require-platform-admin";
import { stripeClient } from "@/lib/stripe";

/**
 * Toda action de esta superficie va envuelta en `platformAction`, que ejecuta
 * `requirePlatformAdmin()` ANTES del cuerpo. La barrera vive en la firma: no hay forma de
 * escribir una action de plataforma sin ella, ni de olvidarla al escribir la siguiente.
 *
 * El comentario anterior justificaba hacerlo a mano diciendo que las dos actions "no comparten
 * forma". Era falso -- ambas son `(formData: FormData) => Promise<void>`, exactamente la forma
 * para la que `managerAction` se diseñó -- y documentaba una excepción que no existía.
 */

/** Host público del cliente recién dado de alta, para el enlace de la invitación. */
function origenDelTenant(slug: string): string {
  const raiz = resolveRootDomains(process.env)[0] ?? "localhost";
  const esLocal = raiz.includes("localhost");
  return `${esLocal ? "http" : "https"}://${slug}.${raiz}${esLocal ? ":3000" : ""}`;
}

export const altaClienteAction = platformAction(async (_session, formData: FormData) => {
  const entrada = parseNuevoCliente(formData);
  const { tenantId } = await createTenantWithOwner({
    ...entrada,
    redirectTo: `${origenDelTenant(entrada.slug)}/staff/nueva-clave`,
  });

  // El cliente de Stripe se crea DESPUÉS del tenant, y su fallo NO aborta el alta: un tenant
  // sin `stripe_customer_id` se sirve igual (nace en `trialing`) y el identificador se engancha
  // luego. Al revés -- abortar el alta porque Stripe no respondió -- dejaría al restaurante sin
  // carta por un problema de facturación, que es justo lo que la ventana de gracia existe para
  // evitar.
  try {
    // IDEMPOTENTE tambien en su mitad de Stripe. Sin esta comprobacion, reintentar un alta
    // que fallo a mitad creaba un SEGUNDO cliente de Stripe y reescribia
    // `stripe_customer_id` con el nuevo. Si la suscripcion (que se crea a mano en Stripe)
    // vivia en el viejo, `applySubscriptionState` dejaba de encontrar el tenant para
    // siempre: sus eventos caerian todos en `billing.cliente_sin_tenant` y ese restaurante
    // no se cortaria NUNCA por impago. Ademas quedaban clientes huerfanos en Stripe sobre los
    // que es facil facturar dos veces.
    //
    // `docs/dar-de-alta-un-cliente.md` promete que el alta es idempotente; esto lo hace
    // cierto tambien aqui.
    const yaTiene = await getTenantStripeCustomer(tenantId);
    if (!yaTiene) {
      const customer = await stripeClient().customers.create(
        {
          email: entrada.ownerEmail,
          name: entrada.name,
          metadata: { tenant_id: tenantId, slug: entrada.slug },
        },
        // Segunda red, por si dos altas del mismo slug se solapan: Stripe devuelve el mismo
        // cliente en vez de crear otro.
        { idempotencyKey: `tenant-${tenantId}` },
      );
      await setTenantStripeCustomer(tenantId, customer.id);
    }
  } catch (error) {
    log.error("plataforma.alta_sin_cliente_stripe", { slug: entrada.slug, tenantId, error });
  }

  revalidatePath("/plataforma");
});

export const cambiarEstadoAction = platformAction(async (_session, formData: FormData) => {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const estado = String(formData.get("estado") ?? "");
  // Lista cerrada: `status` tiene un CHECK en la base, pero no se le manda texto del formulario
  // sin comprobar.
  if (estado !== "active" && estado !== "suspended") return;
  if (!tenantId) return;

  await setTenantStatus(tenantId, estado);
  revalidatePath("/plataforma");
});
