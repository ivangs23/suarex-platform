import { join } from "node:path";
import { app, BrowserWindow, Menu, Notification, nativeImage, Tray } from "electron";
import { WebSocket as WsWebSocket } from "ws";
import { type ActivityAlerts, type AgentActivity, INITIAL_ACTIVITY } from "./agent-activity.js";
import { esArranqueDesatendido, opcionesDeInicioConWindows } from "./arranque-desatendido.js";

// Electron 33 corre sobre Node 20, que NO expone `WebSocket` global (estable desde Node 22).
// Supabase Realtime (`@suarex/realtime` -> subscribeToOrders, la vía rápida del agente ante un
// pedido nuevo) lo exige y, sin él, `startAgent` lanza en el arranque. Se rellena con `ws` antes
// de que nada toque Realtime. Cuando el Electron empaquetado suba a un Node >= 22, el guard lo
// deja pasar sin pisar el nativo.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = WsWebSocket;
}

import {
  establishSessionFromPassword,
  getDeviceClient,
  onAgentActivity,
  receiptPrinterStatus,
  setAppVersion,
  setPrintersProvider,
  startAgent,
  stopAgent,
} from "./agent-runner.js";
import { PLATFORM_WEB_ORIGIN, SUPABASE_ANON_KEY, SUPABASE_URL } from "./baked-config.js";
import { type ChargeJournal, createChargeJournal } from "./charge-journal.js";
import { runChargeRecovery } from "./charge-recovery-runner.js";
import { faltaEnConfigHorneada, mensajeDeConfigIncompleta } from "./config-check.js";
import { loadCredentials, saveCredentials } from "./config-store.js";
import { registerIpc } from "./ipc.js";
import { createLogger, type Logger } from "./logger.js";
import { listLocalPrinters } from "./printers.js";
import { realConfigBackend } from "./real-config-backend.js";
import { realLogSink } from "./real-log-backend.js";
import { realSessionStore } from "./real-session-store.js";
import { openKioskWindow, registerTotemIpc } from "./totem-window.js";
import { TRAY_ICON_DATA_URL } from "./tray-icon.js";
import { startAutoUpdate } from "./updater.js";
import { ensureWatchdogTask, removeWatchdogTask } from "./watchdog.js";
import { destroyWebPanel, layoutWebPanel, setWebPanelReporter } from "./web-panel.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// El logger a fichero se crea en `whenReady` (necesita `app.getPath("userData")`). Hasta
// entonces, y por si un fallo salta antes, `reportMain` cae en `console.error`. La app corre
// oculta en bandeja, así que sin este fichero un crash no dejaba ningún rastro.
let logger: Logger | null = null;
// El diario de cobros vive junto a los datos de la app y se crea en `whenReady`, igual que el
// logger: hasta entonces `app.getPath("userData")` no está disponible.
let chargeJournal: ChargeJournal | null = null;

/** Qué le falta a ESTE ejecutable, calculado una vez al cargar. La ventana lo pregunta por IPC
 * para poder decirlo en pantalla en vez de dejar que cada parte falle por su lado. */
const CONFIG_FALTANTE = faltaEnConfigHorneada({
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  PLATFORM_WEB_ORIGIN,
});
function reportMain(msg: string, err?: unknown): void {
  if (logger) logger.error(msg, err);
  else console.error(msg, err);
}

const TRAY_BASE_TOOLTIP = "SuarEx — Agente de impresión";

// Watchdog dentro del proceso. Este agente corre desatendido: un error suelto no capturado no
// debe llevarse por delante toda la app y dejar la cocina sin imprimir hasta reiniciar el PC.
// Se registra y se sigue vivo -- el bucle del agente ya envuelve cada tick en su try/catch, así
// que sobrevivir aquí es lo que mantiene la impresión en marcha. (La caída del PROPIO proceso
// principal no se recupera desde dentro; para eso haría falta un watchdog del sistema.)
process.on("uncaughtException", (err) => {
  reportMain("[main] excepción no capturada (se sigue):", err);
});
process.on("unhandledRejection", (reason) => {
  reportMain("[main] promesa rechazada sin manejar (se sigue):", reason);
});

/**
 * Reacciona a cada tick del agente: refresca el renderer (aunque la ventana esté oculta, el
 * webContents recibe el mensaje), pone el estado en el tooltip de la bandeja, y NOTIFICA solo
 * las transiciones -- una impresora que acaba de caer o que ha vuelto -- para no repetir el
 * mismo aviso cada 4 s. Sin esto, un fallo de impresión era invisible: la cocina se quedaba
 * sin comandas y nadie se enteraba.
 */
let prevActivity: AgentActivity = INITIAL_ACTIVITY;
function handleAgentActivity(activity: AgentActivity, alerts: ActivityAlerts): void {
  mainWindow?.webContents.send("agent-activity", activity);

  // Log a fichero SOLO de lo que cambió en este tick, no del estado en cada uno de los ~4 s: los
  // tickets recién impresos, las impresoras que acaban de caer o volver, y las transiciones de
  // conexión. Un tick vacío no escribe nada, así el registro cuenta la historia sin inundarse.
  const printed = activity.printedTotal - prevActivity.printedTotal;
  if (printed > 0) logger?.info(`Impresos ${printed} ticket(s) (total ${activity.printedTotal}).`);
  for (const f of alerts.newlyDown) {
    // Sin pedido (`orderNumber` null) el aviso viene de una SONDA: la impresora no responde y
    // todavía no ha perjudicado a nadie, que es justo cuándo conviene enterarse.
    const dondeDuele = f.orderNumber === null ? "" : ` (pedido #${f.orderNumber})`;
    logger?.warn(`Impresora de ${f.destination} sin responder${dondeDuele}: ${f.reason}.`);
  }
  if (alerts.recovered.length > 0) {
    logger?.info(`Impresora(s) recuperada(s): ${alerts.recovered.join(", ")}.`);
  }
  if (activity.lastError && activity.lastError !== prevActivity.lastError) {
    logger?.error(`Sin conexión con la plataforma: ${activity.lastError}`);
  } else if (!activity.lastError && prevActivity.lastError) {
    logger?.info("Conexión con la plataforma recuperada.");
  }
  prevActivity = activity;

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
  app.on("second-instance", (_e, argv) => {
    // El watchdog lanza el exe cada 5 min aunque el agente esté vivo: ese lanzamiento solo
    // comprueba que sigue ahí. Sacar la ventana por él la pondría encima de todo cada 5 min.
    if (esArranqueDesatendido(argv)) return;
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Si el proceso del renderer se cae (no el agente, que vive en el main y sigue imprimiendo),
  // se recarga la ventana en vez de dejarla en blanco. Al salir no se recarga: se está cerrando.
  app.on("render-process-gone", (_e, contents, details) => {
    reportMain("[main] el renderer se cayó:", details.reason);
    if (!quitting && contents === mainWindow?.webContents) mainWindow.reload();
  });

  app.whenReady().then(async () => {
    // Logger a fichero rotativo en userData. Se crea aquí (ya hay `app`) y a partir de este punto
    // el watchdog y los eventos importantes quedan en disco, no solo en un stdout invisible.
    const logSink = realLogSink();
    logger = createLogger(logSink, () => new Date().toISOString());
    logger.info(`Arranque. Versión ${app.getVersion()}, plataforma ${process.platform}.`);
    // Los fallos del panel incrustado (página que no carga, JavaScript que revienta) van al
    // MISMO registro. Sin esto, lo único observable desde fuera era un recuadro en blanco.
    setWebPanelReporter((mensaje) => logger?.error(mensaje));

    /* Un ejecutable incompleto se dice en la PRIMERA línea del registro, antes de intentar nada.
       Si no, lo único que queda escrito es el fallo derivado ("no hay sesión guardada") y quien
       lo lea buscará donde no es. No se aborta: la ventana tiene que abrirse para poder explicarlo
       -- salir en silencio sería otra vez un fallo sin rastro, y encima el watchdog reintentaría
       en bucle algo que ningún reintento arregla. */
    if (CONFIG_FALTANTE.length > 0) {
      logger.error(mensajeDeConfigIncompleta(CONFIG_FALTANTE));
    }

    // El diario de cobros, junto a los datos de la app: es lo que sobrevive a un tirón del
    // enchufe a mitad de un pago. Se crea aquí para que exista ANTES de que se pueda cobrar.
    chargeJournal = createChargeJournal(app.getPath("userData"));

    // Auto-arranque en el login de Windows (desatendido, oculto en bandeja). Solo empaquetado:
    // en dev registraría el `electron.exe` de node_modules para arrancar con cada sesión.
    if (app.isPackaged) app.setLoginItemSettings(opcionesDeInicioConWindows());

    createWindow();
    createTray();
    registerIpc(
      () => mainWindow,
      () => logSink.read(),
      // Recién emparejado: el watchdog del sistema pasa a vigilarlo y, si es un totem, entra en
      // modo kiosko sin reiniciar.
      async () => {
        syncSystemWatchdog(true);
        await maybeStartKiosk();
      },
      () => syncSystemWatchdog(false),
    );
    onAgentActivity(handleAgentActivity);
    // La versión de la build viaja al heartbeat (para saber qué locales están desactualizados).
    setAppVersion(app.getVersion());
    // Las impresoras que ve el SO también viajan al heartbeat, para el desplegable del panel
    // admin. `getPrintersAsync` es de `webContents`; sin ventana viva, lista vacía.
    setPrintersProvider(() => (mainWindow ? listLocalPrinters(mainWindow) : Promise.resolve([])));
    // Auto-update en segundo plano (no hace nada sin feed configurado, p. ej. en dev).
    startAutoUpdate(
      (title, body) => {
        if (Notification.isSupported()) new Notification({ title, body }).show();
      },
      (msg, err) => reportMain(msg, err),
    );

    // Si ya está emparejado, arranca el agente al iniciar (imprime sin abrir la ventana).
    const creds = loadCredentials(realConfigBackend());
    // En cada arranque, y no solo al emparejar: re-registrarla la deja apuntando al exe actual
    // tras una actualización, y borrarla limpia la que dejaron versiones que la registraban
    // estuviera o no emparejado el equipo.
    syncSystemWatchdog(creds !== null);
    if (creds) {
      const store = realSessionStore();
      try {
        if (creds.legacyPassword) {
          // Migración #11: este device se emparejó con una versión que guardaba la contraseña.
          // Un login único deja la sesión (refresh token) en el almacén cifrado, y reescribimos
          // la metadata SIN la contraseña. Transparente: el owner no re-empareja.
          logger.info(`Migrando dispositivo ${creds.deviceId} a sesión por refresh token…`);
          await establishSessionFromPassword(store, creds.email, creds.legacyPassword);
          saveCredentials(realConfigBackend(), {
            deviceId: creds.deviceId,
            email: creds.email,
            tenantId: creds.tenantId,
          });
        }
        logger.info(`Emparejado (dispositivo ${creds.deviceId}). Arrancando el agente…`);
        await startAgent(store, creds.tenantId);
        await recuperarCobrosPendientes();
        await maybeStartKiosk();
      } catch (e) {
        // La sesión no se pudo restaurar/renovar (token revocado o caducado), o falló la
        // migración. No se borra la metadata: la ventana muestra "Emparejado, agente parado" y el
        // owner puede re-emparejar con un código nuevo.
        reportMain("[agent-desktop] no se pudo arrancar el agente (¿re-emparejar?):", e);
      }
    } else {
      logger.info("Sin emparejar. El agente no arranca hasta introducir un código.");
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopAgent();
    destroyWebPanel();
  });
}

/**
 * Watchdog del SISTEMA: una tarea programada resucita el proceso si muere del TODO (crash duro o
 * kill); el watchdog interno solo cubre errores del proceso vivo. Existe mientras el equipo está
 * emparejado y se borra en cuanto deja de estarlo. Solo en un build empaquetado de Windows: en
 * dev el exe es electron.exe y registraría una tarea basura.
 */
function syncSystemWatchdog(paired: boolean): void {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const log = {
    info: (msg: string) => logger?.info(msg),
    error: (msg: string, err?: unknown) => reportMain(msg, err),
  };
  if (paired) ensureWatchdogTask(app.getPath("userData"), app.getPath("exe"), log);
  else removeWatchdogTask(log);
}

/**
 * Resuelve los cobros que quedaron a medias si el totem se apagó en mitad de un pago (#18).
 *
 * Va DESPUÉS de arrancar el agente (necesita su cliente autenticado) y ANTES de abrir la ventana
 * del totem: primero se cierra lo que le pasó al cliente anterior y solo entonces se admite al
 * siguiente. Nunca lanza -- un fallo aquí no puede dejar el local sin totem.
 */
async function recuperarCobrosPendientes(): Promise<void> {
  const client = getDeviceClient();
  if (!client || !chargeJournal) return;
  try {
    await runChargeRecovery({
      client,
      journal: chargeJournal,
      log: (mensaje) => logger?.info(mensaje),
      alert: (outcome) => {
        if (!Notification.isSupported()) return;
        const importe = (outcome.amountCents / 100).toFixed(2);
        const codigo = outcome.authCode
          ? `
Autorización: ${outcome.authCode}`
          : "";
        new Notification({
          title: "Cobro pendiente de resolver",
          body: `${importe} €. ${outcome.detail}.${codigo}`,
        }).show();
      },
    });
  } catch (e) {
    reportMain("[agent-desktop] fallo recuperando cobros pendientes:", e);
  }
}

/**
 * Si este dispositivo es un TOTEM (rol `kiosko`), abre su ventana kiosko con la carta
 * `/totem/<totem_token>`. El token se lee del PROPIO device con su JWT (`devices_select_own` solo
 * devuelve su fila). Un device que solo imprime (rol `agente`) no abre nada: sigue oculto en
 * bandeja imprimiendo. Nunca lanza: un fallo aquí no debe tumbar el arranque del agente.
 */
async function maybeStartKiosk(): Promise<void> {
  try {
    const client = getDeviceClient();
    if (!client || !PLATFORM_WEB_ORIGIN) return;
    const { data } = await client.from("devices").select("roles, totem_token").maybeSingle();
    const roles = (data?.roles as string[] | null) ?? [];
    const token = data?.totem_token as string | undefined;
    if (!token || !roles.includes("kiosko")) return;

    registerTotemIpc(getDeviceClient, receiptPrinterStatus, chargeJournal ?? undefined);
    const kioskWindow = openKioskWindow(`${PLATFORM_WEB_ORIGIN}/totem/${token}`);
    kioskWindow.on("close", (e) => {
      // El totem no se cierra a mano: si alguien lo intenta, se vuelve a mostrar (salvo al salir).
      if (!quitting) {
        e.preventDefault();
        kioskWindow.show();
      }
    });
    logger?.info("Modo totem: ventana kiosko abierta.");
  } catch (e) {
    reportMain("[agent-desktop] no se pudo abrir el modo totem:", e);
  }
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

  // Solo se muestra si el usuario lanzó la app a mano; si la lanzó Windows (inicio de sesión o
  // watchdog), se queda oculta en la bandeja (paso 8 de la checklist de validación).
  mainWindow.once("ready-to-show", () => {
    if (!esArranqueDesatendido(process.argv)) {
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
