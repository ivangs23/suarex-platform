import type { DevicePaymentConfig } from "@suarex/db";
import { terminalField } from "@suarex/payments";
import { createProviderRegistry, type ResolvedPaymentConfig } from "./payment-provider.js";
import { paytefProvider } from "./paytef-provider.js";

/**
 * EL REGISTRO DE MÉTODOS DE PAGO del agente, y cómo se arma la config que recibe un proveedor.
 *
 * Añadir un proveedor mañana es: escribir su fichero (declaración en `@suarex/payments`,
 * implementación aquí al lado) y sumarlo a esta lista. Ni el totem, ni el diario de cobros, ni la
 * recuperación, ni el panel se enteran.
 */
export const paymentRegistry = createProviderRegistry([paytefProvider]);

/**
 * Junta lo que viene de la base en lo que espera un proveedor.
 *
 * Tres piezas que viven en sitios distintos y por buenos motivos: la config visible y los secretos
 * están en la CUENTA del tenant, y el terminal está en el DISPOSITIVO -- un comercio con dos
 * totems tiene dos aparatos y una sola cuenta. Aquí se mezclan en un único mapa de valores.
 *
 * El terminal se coloca bajo el nombre de campo que el proveedor declaró como `terminal`. Eso es
 * lo que permite que `packages/db` no tenga ni idea de que Paytef lo llama "pinpad": la base
 * guarda "el terminal de este dispositivo" y quien sabe cómo se llama es el driver.
 */
export function resolvePaymentConfig(
  providerId: string,
  device: DevicePaymentConfig,
): ResolvedPaymentConfig | null {
  const provider = paymentRegistry.get(providerId);
  if (!provider) return null;

  const values: Record<string, string | boolean | null> = {
    ...device.config,
    ...device.secrets,
  };
  const terminal = terminalField(provider);
  if (terminal) values[terminal.name] = device.terminalId;

  return { provider: providerId, values, mock: device.mock };
}
