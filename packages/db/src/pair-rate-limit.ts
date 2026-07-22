import { pairRateLimitRpc } from "./client.js";

/** Ventana y tope del rate-limit del emparejamiento: 10 intentos por IP cada 60 s.
 * Defensa en profundidad -- ver `20260722000010_pair_rate_limit.sql`. */
const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 10;

/** `true` si el intento de emparejamiento desde `ip` está permitido; `false` si superó el
 * tope de la ventana. Un fallo de la RPC se propaga (el endpoint decide qué hacer). */
export async function checkPairRateLimit(ip: string): Promise<boolean> {
  const { data, error } = await pairRateLimitRpc(ip, WINDOW_SECONDS, MAX_ATTEMPTS);
  if (error) throw error;
  return data === true;
}
