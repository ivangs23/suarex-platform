/**
 * ¿Hay que rotar el token en ESTA petición?
 *
 * `proxy.ts` mantenía viva la sesión del personal llamando a `auth.getUser()` en cada petición
 * a `/staff`. Eso es una ida y vuelta por la red cada vez: 32 ms medidos en local, y visto
 * subir a 579 ms en una sola petición. Lo paga la pantalla de comandas, que es la que está
 * abierta todo el servicio y la que más navega.
 *
 * Y casi siempre sobra: el access token dura una hora. Leer cuándo caduca sale gratis
 * (`getSession()` lee la cookie, 0 ms medidos), así que la red solo se toca cuando de verdad
 * queda poco.
 *
 * Esto NO relaja ninguna comprobación. Rotar el token es mantenimiento, no autorización: quien
 * decide si una petición vale es `resolveStaffSession`, que verifica el claim del JWT en cada
 * página y falla cerrado. Saltarse la rotación solo significa seguir usando un token que
 * todavía es válido.
 */

/** Cuánto antes de caducar se rota. Una hora de vida, un minuto de margen. */
export const MARGEN_MS = 60_000;

/**
 * `expiresAt` viene en SEGUNDOS desde época (formato de `Session.expires_at`), `ahoraMs` en
 * milisegundos. Sin sesión o sin fecha se responde que sí: es lo que hacía antes de este
 * cambio, y ante la duda conviene equivocarse por el lado de refrescar de más.
 */
export function necesitaRefresco(
  expiresAt: number | null | undefined,
  ahoraMs: number,
  margenMs = MARGEN_MS,
): boolean {
  if (!expiresAt) return true;
  return expiresAt * 1000 - ahoraMs <= margenMs;
}
