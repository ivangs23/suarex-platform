import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { FLAG_SEGUNDO_PLANO } from "./arranque-desatendido.js";
import type { Logger } from "./logger.js";

// La tarea programada que resucita el agente si el PROCESO entero muere (crash duro o kill) --
// el watchdog interno (uncaughtException/unhandledRejection) solo cubre errores DENTRO del
// proceso vivo. Cada 5 min lanza el exe del agente: si ya corre, el single-instance lock hace que
// el lanzamiento nuevo salga en el acto y no pase nada; si no corre, arranca.
//
// Lanza el EXE directamente, no un script. La primera versión pasaba por
// `powershell.exe -WindowStyle Hidden` y, validada en un Windows 11 real, falló por tres lados:
// con Windows Terminal como terminal por defecto la ventana NO se oculta (asomaba cada 5 min);
// el agente relanzado heredaba esa consola, así que la ventana se quedaba abierta y CERRARLA
// mataba al agente sin dejar rastro en el registro; y el `.ps1` se leía en ANSI y desfiguraba
// las rutas con tildes. El exe es una app de ventanas, no de consola: nada de eso existe.
//
// Solo existe mientras el equipo está EMPAREJADO: un PC des-emparejado no pertenece a ningún
// restaurante y no debe seguir reabriendo la app cada cinco minutos.
export const WATCHDOG_TASK_NAME = "SuarEx Agente Watchdog";
const INTERVAL_MINUTES = 5;
/** Lo que dejaba en `userData` la versión que pasaba por PowerShell. */
const SCRIPT_OBSOLETO = "watchdog.ps1";

export type WatchdogLog = Pick<Logger, "info" | "error">;

/**
 * Argumentos de `schtasks /Create` para (re)registrar la tarea, lanzando el exe del agente en
 * segundo plano cada `INTERVAL_MINUTES`. `/F` la sobrescribe -> idempotente: registrarla en cada
 * arranque la deja siempre apuntando al exe actual (p. ej. tras una actualización). Puro y
 * testeable; el `exec` real va aparte.
 */
export function schtasksCreateArgs(exePath: string): string[] {
  // La ruta lleva espacios ("SuarEx Agente"), así que va entre comillas dentro del comando.
  const runCommand = `"${exePath}" ${FLAG_SEGUNDO_PLANO}`;
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
 * Registra/actualiza la tarea programada per-user (sin admin) y borra el `.ps1` que dejaba la
 * versión anterior en `userData`. Solo tiene sentido en un build EMPAQUETADO de Windows: en dev
 * el exe es `electron.exe` y registraría una tarea basura. Un fallo aquí NUNCA debe tumbar la app
 * -- es una mejora de resiliencia, no algo de lo que dependa imprimir -- así que se envuelve y se
 * registra.
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
    rmSync(join(userDataDir, SCRIPT_OBSOLETO), { force: true });
    run(schtasksCreateArgs(exePath), (err) => {
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
