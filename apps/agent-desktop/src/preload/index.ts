import { contextBridge, ipcRenderer } from "electron";
import type { OpenAdminResult } from "../main/admin-window.js";
import type { PairIpcResult } from "../main/ipc.js";

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
  openAdmin: (): Promise<OpenAdminResult> => ipcRenderer.invoke("open-admin"),
});
