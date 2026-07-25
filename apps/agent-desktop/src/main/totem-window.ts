import { join } from "node:path";
import type { SupabaseClient } from "@suarex/agent";
import { BrowserWindow, ipcMain } from "electron";
import { chargeKioskoOrder } from "./totem-charge.js";

/** ¿La URL cuelga del mismo origen que el totem? Un `href` externo, un `window.open` o una
 *  redirección a otro sitio no deben poder sacar al cliente de la carta. Una URL ilegible se
 *  rechaza: ante la duda, no se navega. */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Abre la ventana KIOSKO del totem: pantalla completa, sin menús, cargando la carta web de la
 * plataforma (`/totem/<token>`) con el preload que inyecta `window.totem`. Es una ventana distinta
 * del panel del agente: la carta del totem no debe ver las operaciones del agente.
 *
 * Va BLINDADA porque queda desatendida en un local público: nadie debe poder salirse de la carta
 * y acabar con un navegador abierto en el escaparate. Se deniegan las ventanas nuevas, se bloquea
 * cualquier navegación fuera del origen del totem, y las herramientas de desarrollo quedan fuera
 * salvo en dev (donde hacen falta para depurar).
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
      devTools: Boolean(import.meta.env.DEV),
    },
  });

  // Nada de ventanas nuevas: en un kiosko no hay forma de cerrarlas.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Y nada de irse a otro sitio: un enlace externo en la carta dejaría el totem fuera de servicio.
  win.webContents.on("will-navigate", (evento, url) => {
    if (!isSameOrigin(url, totemUrl)) evento.preventDefault();
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
