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
contextBridge.exposeInMainWorld("totem", {
  pay: (orderId: string): Promise<{ ok: true; authCode: string } | { ok: false; reason: string }> =>
    ipcRenderer.invoke("totem-pay", orderId),
});
