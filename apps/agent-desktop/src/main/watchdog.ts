import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// La tarea programada que resucita el agente si el PROCESO entero muere (crash duro o kill) --
// el watchdog interno (uncaughtException/unhandledRejection) solo cubre errores DENTRO del
// proceso vivo. Cada 5 min comprueba si el agente corre y lo relanza si no; el single-instance
// lock del propio agente descarta un lanzamiento duplicado, así que la comprobación es una
// salvaguarda, no un requisito de corrección.
export const WATCHDOG_TASK_NAME = "SuarEx Agente Watchdog";
const INTERVAL_MINUTES = 5;

/**
 * Contenido del `.ps1` que ejecuta la tarea: si NO hay ningún proceso del agente, lo lanza.
 * `Start-Process` no bloquea. El nombre de proceso y la ruta del exe se hornean (no se calculan
 * en runtime) para que el script no dependa de nada. Puro y testeable.
 */
export function watchdogScript(exePath: string, processName: string): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `if (-not (Get-Process -Name '${processName}')) {`,
    `  Start-Process -FilePath '${exePath}'`,
    "}",
    "",
  ].join("\r\n");
}

/**
 * Argumentos de `schtasks /Create` para (re)registrar la tarea, ejecutando el `.ps1` cada
 * `INTERVAL_MINUTES`. `/F` la sobrescribe -> idempotente: registrarla en cada arranque la deja
 * siempre apuntando al exe/script actual (p. ej. tras una actualización). Puro y testeable; el
 * `exec` real va aparte.
 */
export function schtasksCreateArgs(scriptPath: string): string[] {
  const runCommand = `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${scriptPath}"`;
  return [
    "/Create",
    "/TN",
    WATCHDOG_TASK_NAME,
    "/TR",
    runCommand,
    "/SC",
    "MINUTE",
    "/MO",
    String(INTERVAL_MINUTES),
    "/F",
  ];
}

/**
 * Escribe el `.ps1` en `userData` y registra/actualiza la tarea programada per-user (sin admin).
 * Solo tiene sentido en un build EMPAQUETADO de Windows: en dev el exe es `electron.exe` y
 * registraría una tarea basura. Un fallo aquí NUNCA debe tumbar la app -- es una mejora de
 * resiliencia, no algo de lo que dependa imprimir -- así que se envuelve y se registra.
 *
 * NOTA: al desinstalar, la tarea la borra el script NSIS (`build/installer.nsh`), no la app
 * (una desinstalación no ejecuta código de la app).
 */
export function ensureWatchdogTask(
  userDataDir: string,
  exePath: string,
  log: (msg: string, err?: unknown) => void,
): void {
  try {
    const processName = basename(exePath).replace(/\.exe$/i, "");
    const scriptPath = join(userDataDir, "watchdog.ps1");
    writeFileSync(scriptPath, watchdogScript(exePath, processName), "utf8");
    execFile("schtasks", schtasksCreateArgs(scriptPath), (err) => {
      if (err) log("[watchdog] no se pudo registrar la tarea programada:", err);
      else log("[watchdog] tarea programada registrada.");
    });
  } catch (e) {
    log("[watchdog] fallo al preparar el watchdog:", e);
  }
}
