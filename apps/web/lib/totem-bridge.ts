/**
 * PUENTE CON EL DATÁFONO, visto desde la carta.
 *
 * En un totem real la carta se abre dentro de la ventana kiosko del agente-desktop (Electron),
 * cuyo `preload` inyecta `window.totem`. Cobrar es cosa del PROCESO PRINCIPAL del agente, no del
 * navegador: solo él tiene el JWT de `device` y habla con el datáfono por la API de Paytef. La
 * carta solo pide "cobra este pedido" y espera el veredicto -- el importe lo relee el agente del
 * servidor (nunca se lo pasa la carta), para que un XSS no pueda cobrar una cifra a su antojo.
 *
 * Fuera del totem (un navegador normal, o Playwright) `window.totem` NO existe: la carta lo
 * detecta con `getTotemBridge()` y lo dice claramente en vez de fingir un cobro. En e2e, la
 * prueba inyecta su propio stub por `addInitScript`, así que este mismo camino vale para las dos.
 */

/** Veredicto del cobro. Refleja `ChargeOrderResult` del agente (`apps/agent-desktop`). */
export type TotemPayResult = { ok: true; authCode: string } | { ok: false; reason: string };

export type TotemBridge = {
  /**
   * Cobra un pedido del totem por el datáfono. Recibe SOLO el id del pedido: el importe lo relee
   * el agente del servidor. Resuelve aprobado/rechazado; no lanza salvo fallo del propio puente.
   */
  pay: (orderId: string) => Promise<TotemPayResult>;
};

declare global {
  interface Window {
    totem?: TotemBridge;
  }
}

/** El puente si estamos dentro de un totem (o de una prueba que lo inyectó), o `null`. */
export function getTotemBridge(): TotemBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.totem;
  return bridge && typeof bridge.pay === "function" ? bridge : null;
}
