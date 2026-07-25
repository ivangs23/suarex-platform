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

/**
 * Veredicto del cobro. Refleja `ChargeOrderResult` del agente (`apps/agent-desktop`), y son TRES
 * desenlaces a propósito: `declined` significa que no se ha movido un céntimo y se puede
 * reintentar, mientras que `in-doubt` significa que el cliente YA HA PAGADO pero no hemos podido
 * registrarlo. Confundirlos es cobrar dos veces.
 */
export type TotemPayResult =
  | { status: "paid"; authCode: string }
  | { status: "declined"; reason: string }
  | { status: "in-doubt"; authCode: string; reason: string };

/**
 * Estado de la impresora de recibos del totem. Refleja `PrinterStatus` de `@suarex/printing`.
 *
 * `unknown` NO es una avería: es un totem sin impresora de recibos configurada, o un agente que
 * aún no tiene evidencia. La carta solo avisa al cliente en `down` -- avisar sin evidencia
 * convierte el aviso en ruido de fondo y nadie lo lee el día que sí importa.
 */
export type TotemPrinterStatus =
  | { status: "ok"; checkedAt: number }
  | { status: "down"; reason: string; checkedAt: number }
  | { status: "unknown" };

export type TotemBridge = {
  /**
   * Cobra un pedido del totem por el datáfono. Recibe SOLO el id del pedido: el importe lo relee
   * el agente del servidor. Resuelve aprobado/rechazado; no lanza salvo fallo del propio puente.
   */
  pay: (orderId: string) => Promise<TotemPayResult>;
  /**
   * Lo que el agente sabe de la impresora de recibos, sin tocar la red (#15). Opcional en el
   * tipo a propósito: un totem con una versión anterior del escritorio no lo expone, y la carta
   * -- que se despliega antes que el escritorio -- tiene que seguir funcionando ahí sin avisar
   * de nada.
   */
  printerStatus?: () => Promise<TotemPrinterStatus>;
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

/**
 * Lo que se sabe de la impresora de recibos, o `unknown` si no hay forma de saberlo -- fuera de
 * un totem, con un escritorio anterior a #15, o si el propio puente falla. NUNCA lanza: esto se
 * consulta en el camino de cobrar, y un fallo del diagnóstico no puede impedir una venta.
 */
export async function readPrinterStatus(): Promise<TotemPrinterStatus> {
  const bridge = getTotemBridge();
  if (typeof bridge?.printerStatus !== "function") return { status: "unknown" };
  try {
    return await bridge.printerStatus();
  } catch {
    return { status: "unknown" };
  }
}
