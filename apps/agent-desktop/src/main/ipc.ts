import { type BrowserWindow, ipcMain } from "electron";
import { isAgentRunning, startAgent, stopAgent } from "./agent-runner.js";
import { PAIR_ENDPOINT_ORIGIN } from "./baked-config.js";
import { loadCredentials, saveCredentials } from "./config-store.js";
import { pairDevice } from "./pairing.js";
import { listLocalPrinters, printTestTicket } from "./printers.js";
import { realConfigBackend } from "./real-config-backend.js";

/** Registra los canales IPC. El renderer nunca toca Node/Electron directo: todo pasa por
 * estos handlers vía el puente contextBridge del preload. */
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("list-printers", async () => {
    const win = getWindow();
    return win ? listLocalPrinters(win) : [];
  });

  ipcMain.handle("pair", async (_e, pairingCode: string) => {
    const creds = await pairDevice(PAIR_ENDPOINT_ORIGIN, pairingCode); // lanza PairError tipado
    saveCredentials(realConfigBackend(), creds);
    await startAgent(creds);
    return { deviceId: creds.deviceId, tenantId: creds.tenantId };
  });

  ipcMain.handle("test-print", async (_e, printerName: string) => {
    await printTestTicket(printerName);
    return { ok: true };
  });

  ipcMain.handle("get-status", async () => {
    const creds = loadCredentials(realConfigBackend());
    return { paired: creds !== null, running: isAgentRunning(), deviceId: creds?.deviceId ?? null };
  });

  ipcMain.handle("unpair", async () => {
    stopAgent();
    realConfigBackend().write(JSON.stringify({})); // deja el store vacío -> loadCredentials null
    return { ok: true };
  });
}
