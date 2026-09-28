import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { esArranqueDesatendido } from "./arranque-desatendido.js";
import {
  ensureWatchdogTask,
  type RunSchtasks,
  removeWatchdogTask,
  schtasksCreateArgs,
  schtasksDeleteArgs,
  schtasksQueryArgs,
  WATCHDOG_TASK_NAME,
} from "./watchdog.js";

const EXE = "C:\\Users\\Iván\\AppData\\Local\\Programs\\SuarEx Agente\\SuarEx Agente.exe";

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

describe("schtasksCreateArgs", () => {
  it("registra la tarea cada 5 minutos, sobrescribiendo (/F)", () => {
    const args = schtasksCreateArgs(EXE);
    expect(args).toContain("/Create");
    expect(args).toContain("/F");
    expect(args).toEqual(expect.arrayContaining(["/TN", WATCHDOG_TASK_NAME]));
    expect(args).toEqual(expect.arrayContaining(["/SC", "MINUTE", "/MO", "5"]));
  });

  it("lanza el exe del agente directamente, en segundo plano, sin pasar por una consola", () => {
    const args = schtasksCreateArgs(EXE);
    const tr = args[args.indexOf("/TR") + 1] ?? "";
    // La ruta (con espacios y con tildes: va tal cual, sin pasar por ningún fichero) entre comillas.
    expect(tr.startsWith(`"${EXE}" `)).toBe(true);
    // Con el flag del arranque desatendido: si el agente ya corre, no saca su ventana.
    expect(esArranqueDesatendido(tr.split(" "))).toBe(true);
    // Nada de PowerShell: con Windows Terminal su ventana no se oculta y, al cerrarla, mata al
    // agente que haya lanzado.
    expect(tr.toLowerCase()).not.toContain("powershell");
  });
});

describe("ensureWatchdogTask", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("registra la tarea y lo dice como info, no como error", () => {
    dir = mkdtempSync(join(tmpdir(), "watchdog-"));
    const { run, llamadas } = fakeSchtasks();
    const { log, info, error } = fakeLog();

    ensureWatchdogTask(dir, EXE, log, run);

    expect(llamadas).toEqual([schtasksCreateArgs(EXE)]);
    // Que todo fue bien no es un error: si lo fuera, el diagnóstico gritaría en cada arranque.
    expect(info).toEqual(["[watchdog] tarea programada registrada."]);
    expect(error).toEqual([]);
  });

  it("borra el .ps1 que dejaba la versión que pasaba por PowerShell", () => {
    dir = mkdtempSync(join(tmpdir(), "watchdog-"));
    writeFileSync(join(dir, "watchdog.ps1"), "Start-Process ...");
    const { run } = fakeSchtasks();

    ensureWatchdogTask(dir, EXE, fakeLog().log, run);

    expect(existsSync(join(dir, "watchdog.ps1"))).toBe(false);
  });

  it("si schtasks falla lo registra como error, sin lanzar", () => {
    dir = mkdtempSync(join(tmpdir(), "watchdog-"));
    const { run } = fakeSchtasks(() => true);
    const { log, info, error } = fakeLog();

    expect(() => ensureWatchdogTask(dir as string, EXE, log, run)).not.toThrow();
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
