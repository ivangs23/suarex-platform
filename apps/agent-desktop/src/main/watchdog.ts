import { execFile } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
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
// Como el agente que resucita ES la instancia en marcha de la tarea, los ajustes por defecto de
// `schtasks /Create` lo matarían: a las 72 h (límite de ejecución) y al desenchufar un portátil
// (parar si pasa a batería). Y lo dejarían en prioridad "por debajo de lo normal". Esos ajustes
// solo se pueden dar por XML, así que la tarea se registra con `/XML`.
//
// Solo existe mientras el equipo está EMPAREJADO: un PC des-emparejado no pertenece a ningún
// restaurante y no debe seguir reabriendo la app cada cinco minutos.
export const WATCHDOG_TASK_NAME = "SuarEx Agente Watchdog";
const INTERVAL_MINUTES = 5;
/** Lo que dejaba en `userData` la versión que pasaba por PowerShell. */
const SCRIPT_OBSOLETO = "watchdog.ps1";
/** El XML se escribe aquí solo el tiempo de registrarlo. */
const XML_TEMPORAL = "watchdog-tarea.xml";

export type WatchdogLog = Pick<Logger, "info" | "error">;

function escaparXml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** `2026-09-28T13:55:00`: hora local, sin zona, que es como la entiende Task Scheduler. */
function inicioDelMinuto(ahora: Date): string {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}T${dos(ahora.getHours())}:${dos(ahora.getMinutes())}:00`;
}

/**
 * Definición de la tarea: lanzar el exe del agente en segundo plano cada `INTERVAL_MINUTES`, para
 * el usuario que la registra y solo con su sesión abierta. Puro y testeable.
 *
 * - `ExecutionTimeLimit` PT0S (sin límite) y nada de parar ni no arrancar con batería: el agente
 *   resucitado es la instancia en marcha de la tarea y tiene que poder vivir indefinidamente.
 * - `IgnoreNew`: mientras esa instancia vive, las ejecuciones siguientes no hacen nada, que es lo
 *   que se quiere; cuando muere, la siguiente lo resucita.
 * - `Priority` 5 (normal); la de por defecto, 7, lo dejaría por debajo de lo normal.
 */
export function watchdogTaskXml(exePath: string, ahora: Date): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Vuelve a abrir el agente de impresión de SuarEx si se cierra de golpe.</Description>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${inicioDelMinuto(ahora)}</StartBoundary>
      <Repetition>
        <Interval>PT${INTERVAL_MINUTES}M</Interval>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>"${escaparXml(exePath)}"</Command>
      <Arguments>${FLAG_SEGUNDO_PLANO}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

/**
 * Argumentos de `schtasks /Create` para (re)registrar la tarea desde su XML. `/F` la sobrescribe
 * -> idempotente: registrarla en cada arranque la deja siempre apuntando al exe actual (p. ej.
 * tras una actualización). Puro y testeable; el `exec` real va aparte.
 */
export function schtasksCreateArgs(xmlPath: string): string[] {
  return ["/Create", "/TN", WATCHDOG_TASK_NAME, "/XML", xmlPath, "/F"];
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
  ahora: Date = new Date(),
): void {
  try {
    rmSync(join(userDataDir, SCRIPT_OBSOLETO), { force: true });
    // UTF-16 con BOM, como exporta el propio Windows las tareas: la ruta lleva el nombre del
    // usuario y puede traer tildes.
    const xmlPath = join(userDataDir, XML_TEMPORAL);
    const bom = String.fromCharCode(0xfeff);
    writeFileSync(xmlPath, bom + watchdogTaskXml(exePath, ahora), "utf16le");
    run(schtasksCreateArgs(xmlPath), (err) => {
      rmSync(xmlPath, { force: true });
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
