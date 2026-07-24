import { contextBridge, ipcRenderer } from "electron";
import type { AgentActivity } from "../main/agent-activity.js";
import type { ExportDiagnosticsResult, PairIpcResult } from "../main/ipc.js";
import type { ShowWebPanelResult } from "../main/web-panel.js";

/** Puente seguro: el renderer solo ve estas funciones, nunca Node/Electron directo
 * (contextIsolation + nodeIntegration:false). Cada una invoca un handler `ipcMain.handle`. */
contextBridge.exposeInMainWorld("agent", {
  listPrinters: (): Promise<string[]> => ipcRenderer.invoke("list-printers"),
  pair: (code: string): Promise<PairIpcResult> => ipcRenderer.invoke("pair", code),
  testPrint: (printerName: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("test-print", printerName),
  getStatus: (): Promise<{
    paired: boolean;
    running: boolean;
    deviceId: string | null;
    platform: string;
    activity: AgentActivity;
  }> => ipcRenderer.invoke("get-status"),
  confirmUnpair: (): Promise<boolean> => ipcRenderer.invoke("confirm-unpair"),
  unpair: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("unpair"),
  exportDiagnostics: (): Promise<ExportDiagnosticsResult> =>
    ipcRenderer.invoke("export-diagnostics"),
  showSection: (section: string): Promise<ShowWebPanelResult> =>
    ipcRenderer.invoke("show-section", section),
  /** Empuje de cada tick del agente (impresos, fallos, impresoras caídas). Devuelve una función
   *  para desuscribirse. El renderer lo usa para pintar el estado en vivo sin sondear. */
  onActivity: (cb: (activity: AgentActivity) => void): (() => void) => {
    const handler = (_e: unknown, activity: AgentActivity): void => cb(activity);
    ipcRenderer.on("agent-activity", handler);
    return () => ipcRenderer.removeListener("agent-activity", handler);
  },
});
