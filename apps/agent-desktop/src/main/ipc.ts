import { type BrowserWindow, ipcMain } from "electron";
import { getActivity, isAgentRunning, startAgent, stopAgent } from "./agent-runner.js";
import { PLATFORM_WEB_ORIGIN } from "./baked-config.js";
import { loadCredentials, saveCredentials } from "./config-store.js";
import { type PairError, pairDevice } from "./pairing.js";
import { listLocalPrinters, printTestTicket } from "./printers.js";
import { realConfigBackend } from "./real-config-backend.js";
import { hideWebPanel, isWebSection, type ShowWebPanelResult, showWebPanel } from "./web-panel.js";

export type PairIpcResult =
  | { ok: true; deviceId: string; tenantId: string }
  | { ok: false; kind: PairError["kind"] };

function isPairError(e: unknown): e is PairError {
  return typeof e === "object" && e !== null && "kind" in e;
}

/** Registra los canales IPC. El renderer nunca toca Node/Electron directo: todo pasa por
 * estos handlers vía el puente contextBridge del preload. */
export function registerIpc(getWindow: () => BrowserWindow | null): void {
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
    saveCredentials(realConfigBackend(), creds);
    await startAgent(creds);
    return { ok: true, deviceId: creds.deviceId, tenantId: creds.tenantId };
  });

  ipcMain.handle("test-print", async (_e, printerName: string) => {
    await printTestTicket(printerName);
    return { ok: true };
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

  ipcMain.handle("unpair", async () => {
    stopAgent();
    realConfigBackend().write(JSON.stringify({})); // deja el store vacío -> loadCredentials null
    return { ok: true };
  });
}
