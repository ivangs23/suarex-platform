import { autoUpdater } from "electron-updater";
import { UPDATE_FEED_URL } from "./baked-config.js";

const SEIS_HORAS_MS = 6 * 60 * 60 * 1000;

/**
 * Auto-update contra un feed estático (proveedor "generic": una carpeta que sirve
 * `latest.yml` + el instalador NSIS, horneada en `UPDATE_FEED_URL`). Sin esto, un fix obliga a
 * reinstalar a mano en cada local.
 *
 * La actualización se DESCARGA en segundo plano y se instala al CERRAR la app, nunca en
 * caliente: este agente corre desatendido durante el servicio, y reiniciarlo a mitad de la
 * comida dejaría la cocina sin imprimir. Los locales apagan el PC al cerrar, y ahí entra.
 *
 * No hace nada si no hay feed (dev, o build sin configurar): la app arranca igual, solo que no
 * comprueba actualizaciones. `notify` lo inyecta la cáscara para avisar en español cuando una
 * actualización queda lista, sin que este módulo dependa de la UI. `logError` lleva los fallos
 * del updater al registro en fichero (además de la consola), para que se vean en el diagnóstico.
 */
export function startAutoUpdate(
  notify: (title: string, body: string) => void,
  logError: (msg: string, err?: unknown) => void,
): void {
  if (import.meta.env.DEV || !UPDATE_FEED_URL) return;

  autoUpdater.setFeedURL({ provider: "generic", url: UPDATE_FEED_URL });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-downloaded", (info) => {
    notify(
      "Actualización lista",
      `La versión ${info.version} se instalará la próxima vez que se cierre la aplicación.`,
    );
  });
  autoUpdater.on("error", (err) => {
    // Un fallo de actualización (feed caído, sin red) no debe afectar a la impresión: se
    // registra y se reintenta en la siguiente comprobación.
    logError("[updater] error", err);
  });

  const comprobar = (): void => {
    autoUpdater.checkForUpdates().catch((err) => logError("[updater] check falló:", err));
  };
  comprobar();
  setInterval(comprobar, SEIS_HORAS_MS);
}
