import { PAYTEF_INFO } from "./paytef.js";
import type { PaymentProviderInfo } from "./provider-info.js";

/**
 * Los métodos de pago que el producto conoce.
 *
 * Una lista y no un `switch` repartido: el panel la recorre para su desplegable y el agente la usa
 * para resolver el que toque, así que añadir un proveedor es añadir una entrada aquí (y su
 * implementación de cobro en el agente). Ningún otro sitio se entera.
 */
export const PAYMENT_PROVIDERS: PaymentProviderInfo[] = [PAYTEF_INFO];

/** El proveedor con ese id, o `null`. Nunca lanza: una fila guardada por una versión más nueva del
 *  panel -- o con una errata -- no puede tumbar ni el totem ni la pantalla de ajustes. */
export function findProvider(id: string): PaymentProviderInfo | null {
  return PAYMENT_PROVIDERS.find((provider) => provider.id === id) ?? null;
}
