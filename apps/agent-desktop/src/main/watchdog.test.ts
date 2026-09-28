import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureWatchdogTask,
  type RunSchtasks,
  removeWatchdogTask,
  schtasksCreateArgs,
  schtasksDeleteArgs,
  schtasksQueryArgs,
  WATCHDOG_TASK_NAME,
  watchdogScript,
} from "./watchdog.js";

/** Un `schtasks` de mentira: apunta qué se le pidió y responde con el error que diga `fallaSi`. */
function fakeSchtasks(fallaSi: (args: string[]) => boolean = () => false) {
  const llamadas: string[][] = [];
  const run: RunSchtasks = (args, done) => {
    llamadas.push(args);
    done(fallaSi(args) ? new Error("schtasks falló") : null);
  };
  return { run, llamadas };
}

function fakeLog() {
  const info: string[] = [];
  const error: string[] = [];
  return {
    log: { info: (m: string) => info.push(m), error: (m: string) => error.push(m) },
    info,
    error,
  };
}

describe("watchdogScript", () => {
  it("solo lanza el exe si NO hay ya un proceso del agente", () => {
    const script = watchdogScript("C:\\Apps\\SuarEx Agente.exe", "SuarEx Agente");
    expect(script).toContain("Get-Process -Name 'SuarEx Agente'");
    expect(script).toContain("Start-Process -FilePath 'C:\\Apps\\SuarEx Agente.exe'");
    // La comprobación va NEGADA: solo arranca si no corre ya.
    expect(script).toContain("if (-not (Get-Process");
  });

  it("empieza por BOM, o PowerShell 5.1 leería una ruta con tildes en ANSI y no la encontraría", () => {
    const script = watchdogScript("C:\\Users\\Iván\\SuarEx Agente.exe", "SuarEx Agente");
    expect(script.startsWith("\uFEFF")).toBe(true);
    expect(script).toContain("C:\\Users\\Iván\\SuarEx Agente.exe");
  });
});

describe("ensureWatchdogTask", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("escribe en disco el .ps1 con BOM UTF-8 y la ruta intacta, y registra la tarea", () => {
    dir = mkdtempSync(join(tmpdir(), "watchdog-"));
    const { run, llamadas } = fakeSchtasks();
    const { log, info, error } = fakeLog();

    ensureWatchdogTask(
      dir,
      "C:\\Users\\Iván\\AppData\\Local\\Programs\\SuarEx Agente\\SuarEx Agente.exe",
      log,
      run,
    );

    const bytes = readFileSync(join(dir, "watchdog.ps1"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toContain("\\Iván\\");
    expect(llamadas).toEqual([schtasksCreateArgs(join(dir, "watchdog.ps1"))]);
    // Que todo fue bien no es un error: si lo fuera, el diagnóstico gritaría en cada arranque.
    expect(info).toEqual(["[watchdog] tarea programada registrada."]);
    expect(error).toEqual([]);
  });

  it("si schtasks falla lo registra como error, sin lanzar", () => {
    dir = mkdtempSync(join(tmpdir(), "watchdog-"));
    const { run } = fakeSchtasks(() => true);
    const { log, info, error } = fakeLog();

    expect(() =>
      ensureWatchdogTask(dir as string, "C:\\A\\SuarEx Agente.exe", log, run),
    ).not.toThrow();
    expect(error).toEqual(["[watchdog] no se pudo registrar la tarea programada:"]);
    expect(info).toEqual([]);
  });
});

describe("removeWatchdogTask", () => {
  it("si la tarea no existe no intenta borrarla ni ensucia el registro", () => {
    // `/Query` falla cuando la tarea no existe: el caso normal de un equipo sin emparejar.
    const { run, llamadas } = fakeSchtasks((args) => args[0] === "/Query");
    const { log, info, error } = fakeLog();

    removeWatchdogTask(log, run);

    expect(llamadas).toEqual([schtasksQueryArgs()]);
    expect(info).toEqual([]);
    expect(error).toEqual([]);
  });

  it("si existe, la borra", () => {
    const { run, llamadas } = fakeSchtasks();
    const { log, info, error } = fakeLog();

    removeWatchdogTask(log, run);

    expect(llamadas).toEqual([schtasksQueryArgs(), schtasksDeleteArgs()]);
    expect(info).toHaveLength(1);
    expect(error).toEqual([]);
  });

  it("si existe y no se puede borrar, lo registra como error", () => {
    const { run } = fakeSchtasks((args) => args[0] === "/Delete");
    const { log, error } = fakeLog();

    removeWatchdogTask(log, run);

    expect(error).toEqual(["[watchdog] no se pudo borrar la tarea programada:"]);
  });

  it("consulta y borra la MISMA tarea que se registra, y borra sin pedir confirmación", () => {
    expect(schtasksQueryArgs()).toEqual(expect.arrayContaining(["/TN", WATCHDOG_TASK_NAME]));
    expect(schtasksDeleteArgs()).toEqual(expect.arrayContaining(["/TN", WATCHDOG_TASK_NAME, "/F"]));
  });
});

describe("schtasksCreateArgs", () => {
  it("registra la tarea cada 5 minutos, sobrescribiendo (/F), corriendo el .ps1", () => {
    const args = schtasksCreateArgs("C:\\Users\\x\\AppData\\Roaming\\SuarEx Agente\\watchdog.ps1");
    expect(args).toContain("/Create");
    expect(args).toContain("/F");
    expect(args).toEqual(expect.arrayContaining(["/TN", WATCHDOG_TASK_NAME]));
    expect(args).toEqual(expect.arrayContaining(["/SC", "MINUTE", "/MO", "5"]));

    const tr = args[args.indexOf("/TR") + 1];
    expect(tr).toContain("powershell.exe");
    expect(tr).toContain("-WindowStyle Hidden");
    // La ruta del script (con espacios) va entre comillas dentro del comando de la tarea.
    expect(tr).toContain('-File "C:\\Users\\x\\AppData\\Roaming\\SuarEx Agente\\watchdog.ps1"');
  });
});
