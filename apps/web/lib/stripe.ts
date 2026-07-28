import Stripe from "stripe";
import { pickStripeKeys, type StripeKeyChoice } from "./stripe-keys";

/**
 * Un cliente de Stripe POR CLAVE, no uno global.
 *
 * Cada negocio cobra en su propia cuenta, así que el cliente depende de con qué clave se hable.
 * Se cachea por clave -- no una única instancia -- porque instanciar `Stripe` en cada pedido
 * abriría un pool de conexiones nuevo cada vez, y porque un cliente compartido entre cuentas es
 * exactamente el error que este cambio existe para quitar.
 */
const clientesPorClave = new Map<string, Stripe>();

export function stripeClientWithKey(secretKey: string): Stripe {
  const cacheado = clientesPorClave.get(secretKey);
  if (cacheado) return cacheado;
  const cliente = new Stripe(secretKey);
  clientesPorClave.set(secretKey, cliente);
  return cliente;
}

/** Las credenciales del entorno: lo que se usa mientras un negocio no tenga las suyas. */
export function stripeEnvCredentials() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY ?? null,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
  };
}

/**
 * Con qué claves cobra ESTE negocio: las suyas si las tiene, las del entorno si no. La regla de
 * todo-o-nada vive en `pickStripeKeys`, pura y probada aparte.
 */
export async function resolveStripeKeys(tenantId: string): Promise<StripeKeyChoice> {
  const { getStripeCredentials } = await import("@suarex/db");
  return pickStripeKeys(await getStripeCredentials(tenantId), stripeEnvCredentials());
}
