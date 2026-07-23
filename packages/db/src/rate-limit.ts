import { rateLimitRpc } from "./client.js";

/**
 * Rate-limit genérico por (bucket, key) sobre la tabla `rate_limit_hits`
 * (`20260723000002_order_rate_limit.sql`). Devuelve `true` si el intento está permitido,
 * `false` si superó el tope de su ventana. Un fallo de la RPC se propaga: quien llama decide
 * qué hacer (el endpoint de pedidos falla cerrado -- ver su uso).
 */
export async function checkRateLimit(
  bucket: string,
  key: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  const { data, error } = await rateLimitRpc(bucket, key, windowSeconds, max);
  if (error) throw error;
  return data === true;
}

/**
 * Tope de creación de pedidos POR MESA: la mesa es el eje correcto del abuso -- un escaneo
 * es una mesa -- y limitar por mesa acota un flood sin molestar a una mesa que pide varias
 * rondas a lo largo de la comida. 10 pedidos cada 2 minutos: una mesa que dispara 10
 * comandas en dos minutos ya es anómala, y un flood queda acotado a eso en vez de a infinito.
 */
export const ORDER_RATE_WINDOW_SECONDS = 120;
export const ORDER_RATE_MAX = 10;

/** `true` si esta mesa puede crear otro pedido ahora; `false` si superó su tope. */
export function checkOrderRateLimit(tableId: string): Promise<boolean> {
  return checkRateLimit("order", tableId, ORDER_RATE_WINDOW_SECONDS, ORDER_RATE_MAX);
}
