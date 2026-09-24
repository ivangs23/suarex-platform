import { contextBridge, ipcRenderer } from "electron";

/**
 * Puente del TOTEM. La ventana kiosko carga la carta web de la plataforma (`/totem/<token>`), y
 * este preload le inyecta `window.totem` -- el mismo contrato que la carta espera
 * (`apps/web/lib/totem-bridge.ts`). Cobrar es cosa del PROCESO PRINCIPAL (tiene el JWT del device
 * y habla con Paytef): la carta solo pide "cobra este pedido" y recibe el veredicto.
 *
 * Separado del preload del panel (`index.ts`, que expone `window.agent`) a propósito: la carta del
 * totem NO debe ver las operaciones del agente (emparejar, imprimir prueba, desemparejar), solo
 * `pay`. Cada ventana carga el preload que le corresponde.
 */
/** Mismo contrato de tres desenlaces que `ChargeOrderResult` y `TotemPayResult` de la carta. */
type PayResult =
  | { status: "paid"; authCode: string }
  | { status: "declined"; reason: string }
  | { status: "in-doubt"; authCode: string; reason: string };

contextBridge.exposeInMainWorld("totem", {
  pay: (orderId: string): Promise<PayResult> => ipcRenderer.invoke("totem-pay", orderId),
});
