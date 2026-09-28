import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Logger } from "./logger.js";

// La tarea programada que resucita el agente si el PROCESO entero muere (crash duro o kill) --
// el watchdog interno (uncaughtException/unhandledRejection) solo cubre errores DENTRO del
// proceso vivo. Cada 5 min comprueba si el agente corre y lo relanza si no; el single-instance
// lock del propio agente descarta un lanzamiento duplicado, así que la comprobación es una
// salvaguarda, no un requisito de corrección.
//
// Solo existe mientras el equipo está EMPAREJADO: un PC des-emparejado no pertenece a ningún
// restaurante y no debe seguir reabriendo la app cada cinco minutos.
export const WATCHDOG_TASK_NAME = "SuarEx Agente Watchdog";
const INTERVAL_MINUTES = 5;

export type WatchdogLog = Pick<Logger, "info" | "error">;

/**
 * Contenido EXACTO del `.ps1` que ejecuta la tarea: si NO hay ningún proceso del agente, lo lanza.
 * `Start-Process` no bloquea. El nombre de proceso y la ruta del exe se hornean (no se calculan
 * en runtime) para que el script no dependa de nada. Puro y testeable.
 *
 * Empieza por BOM a propósito. Windows PowerShell 5.1 lee un `.ps1` SIN BOM en la página de
 * códigos ANSI (1252 en un Windows español), y la ruta del exe lleva el nombre del usuario
 * porque la instalación es por usuario: en el PC de "Iván" se leería `IvÃ¡n`, `Start-Process`
 * apuntaría a una ruta que no existe y el watchdog no resucitaría nada, en silencio.
 */
export function watchdogScript(exePath: string, processName: string): string {
  return [
    "\uFEFF$ErrorActionPreference = 'SilentlyContinue'",
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

/** Argumentos de `schtasks /Query`: sale con error si la tarea no existe. */
export function schtasksQueryArgs(): string[] {
  return ["/Query", "/TN", WATCHDOG_TASK_NAME];
}

/** Argumentos de `schtasks /Delete`, sin pedir confirmación (`/F`). */
export function schtasksDeleteArgs(): string[] {
  return ["/Delete", "/TN", WATCHDOG_TASK_NAME, "/F"];
}

/** Ejecuta `schtasks` con esos argumentos. Inyectable para poder probar la lógica sin Windows. */
export type RunSchtasks = (args: string[], done: (err: Error | null) => void) => void;

const runSchtasks: RunSchtasks = (args, done) => {
  execFile("schtasks", args, (err) => done(err));
};

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
  log: WatchdogLog,
  run: RunSchtasks = runSchtasks,
): void {
  try {
    const processName = basename(exePath).replace(/\.exe$/i, "");
    const scriptPath = join(userDataDir, "watchdog.ps1");
    writeFileSync(scriptPath, watchdogScript(exePath, processName), "utf8");
    run(schtasksCreateArgs(scriptPath), (err) => {
      if (err) log.error("[watchdog] no se pudo registrar la tarea programada:", err);
      else log.info("[watchdog] tarea programada registrada.");
    });
  } catch (e) {
    log.error("[watchdog] fallo al preparar el watchdog:", e);
  }
}

/**
 * Borra la tarea si existe. Se consulta antes de borrar porque lo normal en un equipo sin
 * emparejar es que NO exista, y `/Delete` a secas dejaría un error en el registro en cada
 * arranque -- justo el ruido que hace que nadie lea el registro cuando importa.
 */
export function removeWatchdogTask(log: WatchdogLog, run: RunSchtasks = runSchtasks): void {
  run(schtasksQueryArgs(), (queryErr) => {
    if (queryErr) return;
    run(schtasksDeleteArgs(), (err) => {
      if (err) log.error("[watchdog] no se pudo borrar la tarea programada:", err);
      else log.info("[watchdog] tarea programada borrada: el equipo ya no está emparejado.");
    });
  });
}
