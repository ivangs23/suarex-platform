import { join } from "node:path";
import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import { startAgent, stopAgent } from "./agent-runner.js";
import { loadCredentials } from "./config-store.js";
import { registerIpc } from "./ipc.js";
import { realConfigBackend } from "./real-config-backend.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

/** Single-instance: una segunda ejecución enfoca la existente en vez de abrir otra. */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Auto-arranque en el login de Windows (desatendido, oculto en bandeja).
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });

    createWindow();
    createTray();
    registerIpc(() => mainWindow);

    // Si ya está emparejado, arranca el agente al iniciar (imprime sin abrir la ventana).
    const creds = loadCredentials(realConfigBackend());
    if (creds) {
      await startAgent(creds).catch((e) =>
        console.error("[agent-desktop] no se pudo arrancar el agente:", e),
      );
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopAgent();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 620,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Solo se muestra si el usuario lanzó la app a mano; si fue el auto-arranque de Windows
  // en el login, se queda oculta en la bandeja (paso 8 de la checklist de validación).
  mainWindow.once("ready-to-show", () => {
    if (!app.getLoginItemSettings().wasOpenedAtLogin) {
      mainWindow?.show();
    }
  });

  // Cerrar la ventana la oculta a la bandeja (no cierra la app) salvo que estemos saliendo.
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  if (import.meta.env.DEV) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL as string);
  } else {
    mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

function createTray(): void {
  // Un icono vacío de 16x16 basta para el scaffold; se reemplaza por el real en el empaquetado.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("SuarEx — Agente de impresión");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir", click: () => mainWindow?.show() },
      { type: "separator" },
      {
        label: "Salir",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => mainWindow?.show());
}
