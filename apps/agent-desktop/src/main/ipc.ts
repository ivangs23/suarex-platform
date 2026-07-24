import { writeFileSync } from "node:fs";
import { DEVICE_SESSION_STORAGE_KEY, type NetworkPrinterProbe } from "@suarex/agent";
import { app, type BrowserWindow, dialog, ipcMain } from "electron";
import {
  establishSessionFromPassword,
  getActivity,
  isAgentRunning,
  probeNetworkPrinters,
  startAgent,
  stopAgent,
} from "./agent-runner.js";
import { PLATFORM_WEB_ORIGIN } from "./baked-config.js";
import { loadCredentials, saveCredentials } from "./config-store.js";
import { formatDiagnostics } from "./diagnostics.js";
import { type PairError, pairDevice } from "./pairing.js";
import { listLocalPrinters, printTestTicket } from "./printers.js";
import { realConfigBackend } from "./real-config-backend.js";
import { realSessionStore } from "./real-session-store.js";
import { hideWebPanel, isWebSection, type ShowWebPanelResult, showWebPanel } from "./web-panel.js";

export type PairIpcResult =
  | { ok: true; deviceId: string; tenantId: string }
  | { ok: false; kind: PairError["kind"] };

export type ExportDiagnosticsResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }
  | { ok: false; error: string };

export type ProbeNetworkPrintersResult =
  | { ok: true; printers: NetworkPrinterProbe[] }
  | { ok: false; reason: "agent-not-running" };

function isPairError(e: unknown): e is PairError {
  return typeof e === "object" && e !== null && "kind" in e;
}

/** Registra los canales IPC. El renderer nunca toca Node/Electron directo: todo pasa por
 * estos handlers vía el puente contextBridge del preload. `readLog` vuelca el registro en disco
 * (inyectado desde el sink real) para el diagnóstico exportable. */
export function registerIpc(getWindow: () => BrowserWindow | null, readLog: () => string): void {
  // Navegación de la barra lateral. El renderer manda solo un NOMBRE de sección; la ruta y
  // el origen salen de `WEB_SECTIONS` y del origen horneado en el build, nunca de una
  // cadena que el renderer pueda componer -- de lo contrario, un XSS en la interfaz local
  // podría hacer que el panel cargara cualquier URL.
  ipcMain.handle("show-section", (_e, section: string): ShowWebPanelResult => {
    const win = getWindow();
    if (!win) return { ok: false, reason: "sin-origen-configurado" };
    if (!isWebSection(section)) {
      // Sección local (config, impresoras): la pinta el propio renderer, así que solo hay
      // que quitar de en medio la vista incrustada, que se superpone.
      hideWebPanel();
      return { ok: true };
    }
    return showWebPanel(win, section);
  });

  ipcMain.handle("list-printers", async () => {
    const win = getWindow();
    return win ? listLocalPrinters(win) : [];
  });

  ipcMain.handle("pair", async (_e, pairingCode: string): Promise<PairIpcResult> => {
    // `pairDevice` lanza un `PairError` plano ({kind}); `ipcRenderer.invoke` solo reenvía
    // fiablemente `Error.message` a través de la frontera IPC, así que el discriminante
    // `kind` se perdería si dejáramos que el throw cruzara tal cual. Lo atrapamos aquí y
    // devolvemos un resultado discriminado, para que el renderer pueda distinguir
    // "código inválido" de "rate-limited" de "fallo de red". Solo se captura el `PairError`
    // de `pairDevice`: un fallo inesperado en `saveCredentials`/`startAgent` (ya emparejado,
    // fallo al persistir o arrancar) no es un error de emparejamiento y debe seguir
    // rechazando la promesa tal cual, para no camuflarlo como "fallo de red".
    let creds: Awaited<ReturnType<typeof pairDevice>>;
    try {
      creds = await pairDevice(PLATFORM_WEB_ORIGIN, pairingCode);
    } catch (e) {
      if (isPairError(e)) return { ok: false, kind: e.kind };
      throw e;
    }
    // Login ÚNICO con la contraseña que devolvió el pairing: deja la sesión (refresh token)
    // persistida en el almacén cifrado y descarta la contraseña -- NUNCA se guarda en disco (#11).
    const store = realSessionStore();
    await establishSessionFromPassword(store, creds.email, creds.password);
    saveCredentials(realConfigBackend(), {
      deviceId: creds.deviceId,
      email: creds.email,
      tenantId: creds.tenantId,
    });
    await startAgent(store, creds.tenantId);
    return { ok: true, deviceId: creds.deviceId, tenantId: creds.tenantId };
  });

  ipcMain.handle("test-print", async (_e, printerName: string) => {
    await printTestTicket(printerName);
    return { ok: true };
  });

  // Estado de las impresoras de RED (#12): sondea su conexión TCP con el cliente del agente en
  // marcha. Distinto del "Imprimir prueba" USB (winspool). Si el agente no corre, no hay cliente
  // ni impresoras que resolver -> se lo decimos a la UI en vez de devolver una lista vacía
  // ambigua.
  ipcMain.handle("probe-network-printers", async (): Promise<ProbeNetworkPrintersResult> => {
    const printers = await probeNetworkPrinters();
    if (printers === null) return { ok: false, reason: "agent-not-running" };
    return { ok: true, printers };
  });

  ipcMain.handle("get-status", async () => {
    const creds = loadCredentials(realConfigBackend());
    return {
      paired: creds !== null,
      running: isAgentRunning(),
      deviceId: creds?.deviceId ?? null,
      // La interfaz lo usa para AVISAR de que la impresión USB (winspool) solo existe en
      // Windows, en vez de dejar que el usuario lo descubra al pulsar "Imprimir prueba" y
      // recibir un error. `process` no está disponible en el renderer (contextIsolation),
      // así que viaja por aquí.
      platform: process.platform,
      // Estado de impresión acumulado, para que la ventana ya muestre lo que va pasando nada
      // más abrirse (sin esperar al primer tick que llegue por `agent-activity`).
      activity: getActivity(),
    };
  });

  // Confirmación nativa antes de des-emparejar: un clic accidental dejaría la cocina sin
  // imprimir hasta re-emparejar con un código nuevo. Devuelve si el usuario confirmó; el
  // borrado real lo hace `unpair`, que se queda puro y testeable.
  ipcMain.handle("confirm-unpair", async (): Promise<boolean> => {
    const win = getWindow();
    const opciones = {
      type: "warning" as const,
      buttons: ["Cancelar", "Des-emparejar"],
      defaultId: 0,
      cancelId: 0,
      title: "Des-emparejar dispositivo",
      message: "¿Seguro que quieres des-emparejar este equipo?",
      detail:
        "Dejará de recibir e imprimir pedidos hasta que lo vuelvas a emparejar con un código nuevo.",
    };
    const { response } = win
      ? await dialog.showMessageBox(win, opciones)
      : await dialog.showMessageBox(opciones);
    return response === 1;
  });

  ipcMain.handle("unpair", async () => {
    stopAgent();
    realConfigBackend().write(JSON.stringify({})); // deja el store vacío -> loadCredentials null
    // Borra también la sesión persistida (refresh token): sin esto quedaría en disco una sesión
    // válida de un device supuestamente des-emparejado.
    realSessionStore().removeItem(DEVICE_SESSION_STORAGE_KEY);
    return { ok: true };
  });

  // Exportar diagnóstico: la app corre oculta en bandeja, así que su registro vive en un
  // fichero al que el owner no llega solo. Esto lo vuelca -- metadatos, estado de impresión y el
  // log -- a un fichero de texto que elige, para poder enviárnoslo cuando algo va mal.
  ipcMain.handle("export-diagnostics", async (): Promise<ExportDiagnosticsResult> => {
    const creds = loadCredentials(realConfigBackend());
    const contenido = formatDiagnostics(
      {
        generatedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        platform: process.platform,
        paired: creds !== null,
        deviceId: creds?.deviceId ?? null,
        running: isAgentRunning(),
      },
      getActivity(),
      readLog(),
    );

    // Nombre por defecto sin ':' (inválido en rutas de Windows).
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const win = getWindow();
    const opciones = {
      title: "Exportar diagnóstico",
      defaultPath: `suarex-diagnostico-${stamp}.txt`,
      filters: [{ name: "Texto", extensions: ["txt"] }],
    };
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, opciones)
      : await dialog.showSaveDialog(opciones);
    if (canceled || !filePath) return { ok: false, canceled: true };

    try {
      writeFileSync(filePath, contenido, "utf8");
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
}
