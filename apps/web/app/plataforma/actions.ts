"use server";

import { resolveRootDomains } from "@suarex/config";
import { createTenantWithOwner, setTenantStatus, setTenantStripeCustomer } from "@suarex/db";
import { revalidatePath } from "next/cache";
import { log } from "@/lib/log";
import { parseNuevoCliente } from "@/lib/platform-action-input";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { stripeClient } from "@/lib/stripe";

/**
 * TODA action de esta superficie empieza por `requirePlatformAdmin()`. Aquí no hay un wrapper
 * como `managerAction` que lo garantice estructuralmente porque son dos y no comparten forma,
 * pero la regla no tiene excepciones: una action de plataforma sin ese guard es un fallo de
 * revisión, no un descuido tolerable.
 */

/** Host público del cliente recién dado de alta, para el enlace de la invitación. */
function origenDelTenant(slug: string): string {
  const raiz = resolveRootDomains(process.env)[0] ?? "localhost";
  const esLocal = raiz.includes("localhost");
  return `${esLocal ? "http" : "https"}://${slug}.${raiz}${esLocal ? ":3000" : ""}`;
}

export async function altaClienteAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

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
    const customer = await stripeClient().customers.create({
      email: entrada.ownerEmail,
      name: entrada.name,
      metadata: { tenant_id: tenantId, slug: entrada.slug },
    });
    await setTenantStripeCustomer(tenantId, customer.id);
  } catch (error) {
    log.error("plataforma.alta_sin_cliente_stripe", { slug: entrada.slug, tenantId, error });
  }

  revalidatePath("/plataforma");
}

export async function cambiarEstadoAction(formData: FormData): Promise<void> {
  await requirePlatformAdmin();

  const tenantId = String(formData.get("tenant_id") ?? "");
  const estado = String(formData.get("estado") ?? "");
  // Lista cerrada: `status` tiene un CHECK en la base, pero no se le manda texto del formulario
  // sin comprobar.
  if (estado !== "active" && estado !== "suspended") return;
  if (!tenantId) return;

  await setTenantStatus(tenantId, estado);
  revalidatePath("/plataforma");
}
