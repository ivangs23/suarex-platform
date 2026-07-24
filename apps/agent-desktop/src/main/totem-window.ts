import { join } from "node:path";
import type { SupabaseClient } from "@suarex/agent";
import { BrowserWindow, ipcMain } from "electron";
import { chargeKioskoOrder } from "./totem-charge.js";

/**
 * Abre la ventana KIOSKO del totem: pantalla completa, sin menús, cargando la carta web de la
 * plataforma (`/totem/<token>`) con el preload que inyecta `window.totem`. Es una ventana distinta
 * del panel del agente: la carta del totem no debe ver las operaciones del agente.
 */
export function openKioskWindow(totemUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/totem.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(totemUrl);
  return win;
}

let registered = false;

/**
 * Registra el handler `totem-pay` (una sola vez). Cobra con el cliente del device del agente en
 * marcha (`getClient`), que es el MISMO que imprime -- una sola sesión, sin dos bucles de refresh.
 * Sin cliente (agente no arrancado) devuelve un fallo claro en vez de reventar.
 */
export function registerTotemIpc(getClient: () => SupabaseClient | null): void {
  if (registered) return;
  registered = true;
  ipcMain.handle("totem-pay", async (_event, orderId: string) => {
    const client = getClient();
    if (!client) return { ok: false, reason: "El totem no está conectado a la plataforma" };
    if (typeof orderId !== "string" || orderId.length === 0) {
      return { ok: false, reason: "Pedido inválido" };
    }
    return chargeKioskoOrder(client, orderId);
  });
}
