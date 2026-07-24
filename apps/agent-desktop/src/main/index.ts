import { join } from "node:path";
import { app, BrowserWindow, Menu, Notification, nativeImage, Tray } from "electron";
import type { ActivityAlerts, AgentActivity } from "./agent-activity.js";
import { onAgentActivity, startAgent, stopAgent } from "./agent-runner.js";
import { loadCredentials } from "./config-store.js";
import { registerIpc } from "./ipc.js";
import { realConfigBackend } from "./real-config-backend.js";
import { TRAY_ICON_DATA_URL } from "./tray-icon.js";
import { destroyWebPanel, layoutWebPanel } from "./web-panel.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

const TRAY_BASE_TOOLTIP = "SuarEx — Agente de impresión";

/**
 * Reacciona a cada tick del agente: refresca el renderer (aunque la ventana esté oculta, el
 * webContents recibe el mensaje), pone el estado en el tooltip de la bandeja, y NOTIFICA solo
 * las transiciones -- una impresora que acaba de caer o que ha vuelto -- para no repetir el
 * mismo aviso cada 4 s. Sin esto, un fallo de impresión era invisible: la cocina se quedaba
 * sin comandas y nadie se enteraba.
 */
function handleAgentActivity(activity: AgentActivity, alerts: ActivityAlerts): void {
  mainWindow?.webContents.send("agent-activity", activity);

  if (tray) {
    const caidas = activity.downPrinters.length;
    tray.setToolTip(
      activity.lastError
        ? `${TRAY_BASE_TOOLTIP} — sin conexión`
        : caidas > 0
          ? `${TRAY_BASE_TOOLTIP} — ${caidas} impresora(s) sin responder`
          : TRAY_BASE_TOOLTIP,
    );
  }

  if (!Notification.isSupported()) return;
  const [primerFallo, ...restoFallos] = alerts.newlyDown;
  if (primerFallo) {
    const nombreDestino = (d: string): string =>
      d === "cocina" ? "cocina" : d === "barra" ? "barra" : "cocina y barra";
    const body =
      restoFallos.length === 0
        ? `La de ${nombreDestino(primerFallo.destination)} no responde. Revisa que esté encendida y conectada.`
        : `${alerts.newlyDown.length} impresoras no responden. Revisa que estén encendidas y conectadas.`;
    new Notification({ title: "Impresora sin responder", body }).show();
  }
  if (alerts.recovered.length > 0) {
    new Notification({
      title: "Impresora recuperada",
      body: "Vuelve a imprimir con normalidad.",
    }).show();
  }
}

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
    onAgentActivity(handleAgentActivity);

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
    destroyWebPanel();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    // Más ancha que antes: ahora la ventana aloja la barra lateral MÁS el panel de la
    // plataforma incrustado (catálogo, pedidos), que necesita sitio para respirar.
    width: 1140,
    height: 780,
    minWidth: 900,
    minHeight: 600,
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

  // El panel incrustado NO se recoloca solo: es una vista hermana del renderer, con sus
  // propios bounds en píxeles. Sin esto, al redimensionar la ventana se queda del tamaño
  // anterior y deja una franja muerta o tapa la barra lateral.
  mainWindow.on("resize", () => {
    if (mainWindow) layoutWebPanel(mainWindow);
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
  // Icono real (la app vive OCULTA en la bandeja al arrancar; sin icono no se puede reabrir).
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL));
  tray.setToolTip(TRAY_BASE_TOOLTIP);
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
