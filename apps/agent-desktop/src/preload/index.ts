import { contextBridge, ipcRenderer } from "electron";
import type { PairIpcResult } from "../main/ipc.js";
import type { ShowWebPanelResult } from "../main/web-panel.js";

/** Puente seguro: el renderer solo ve estas funciones, nunca Node/Electron directo
 * (contextIsolation + nodeIntegration:false). Cada una invoca un handler `ipcMain.handle`. */
contextBridge.exposeInMainWorld("agent", {
  listPrinters: (): Promise<string[]> => ipcRenderer.invoke("list-printers"),
  pair: (code: string): Promise<PairIpcResult> => ipcRenderer.invoke("pair", code),
  testPrint: (printerName: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("test-print", printerName),
  getStatus: (): Promise<{ paired: boolean; running: boolean; deviceId: string | null }> =>
    ipcRenderer.invoke("get-status"),
  unpair: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("unpair"),
  showSection: (section: string): Promise<ShowWebPanelResult> =>
    ipcRenderer.invoke("show-section", section),
});
