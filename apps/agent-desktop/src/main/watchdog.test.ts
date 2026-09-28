import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  watchdogTaskXml,
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

/** El valor de una etiqueta del XML de la tarea (todas las que usa aparecen una sola vez). */
function etiqueta(xml: string, nombre: string): string | undefined {
  return xml.match(new RegExp(`<${nombre}>([^<]*)</${nombre}>`))?.[1];
}

describe("watchdogTaskXml", () => {
  const xml = watchdogTaskXml(EXE, new Date(2026, 8, 28, 13, 57, 42));

  it("lanza el exe del agente directamente, en segundo plano, sin pasar por una consola", () => {
    // La ruta (con espacios) entre comillas; con tildes tal cual, porque el fichero va en UTF-16.
    expect(etiqueta(xml, "Command")).toBe(`"${EXE}"`);
    // Con el flag del arranque desatendido: si el agente ya corre, no saca su ventana.
    expect(esArranqueDesatendido([etiqueta(xml, "Arguments") ?? ""])).toBe(true);
    // Nada de PowerShell: con Windows Terminal su ventana no se oculta y, al cerrarla, mata al
    // agente que haya lanzado.
    expect(xml.toLowerCase()).not.toContain("powershell");
  });

  it("cada 5 minutos desde el minuto en que se registra, en hora local", () => {
    expect(etiqueta(xml, "Interval")).toBe("PT5M");
    expect(etiqueta(xml, "StartBoundary")).toBe("2026-09-28T13:57:00");
  });

  it("no mata al agente que resucita: sin límite de tiempo y sin pararlo por batería", () => {
    // El agente resucitado ES la instancia en marcha de la tarea. Los valores por defecto lo
    // matarían a las 72 h y al desenchufar un portátil.
    expect(etiqueta(xml, "ExecutionTimeLimit")).toBe("PT0S");
    expect(etiqueta(xml, "StopIfGoingOnBatteries")).toBe("false");
    expect(etiqueta(xml, "DisallowStartIfOnBatteries")).toBe("false");
    // Mientras vive, las ejecuciones siguientes no hacen nada.
    expect(etiqueta(xml, "MultipleInstancesPolicy")).toBe("IgnoreNew");
    // Prioridad normal: la de por defecto (7) lo dejaría por debajo de lo normal.
    expect(etiqueta(xml, "Priority")).toBe("5");
  });

  it("escapa la ruta para que un & en el nombre del usuario no rompa el XML", () => {
    const conAmpersand = watchdogTaskXml("C:\\Users\\Pili & Mili\\SuarEx Agente.exe", new Date());
    expect(etiqueta(conAmpersand, "Command")).toBe(
      '"C:\\Users\\Pili &amp; Mili\\SuarEx Agente.exe"',
    );
  });
});

describe("schtasksCreateArgs", () => {
  it("registra la tarea desde su XML, sobrescribiendo (/F)", () => {
    expect(schtasksCreateArgs("C:\\x\\tarea.xml")).toEqual([
      "/Create",
      "/TN",
      WATCHDOG_TASK_NAME,
      "/XML",
      "C:\\x\\tarea.xml",
      "/F",
    ]);
  });
});

describe("ensureWatchdogTask", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("registra la tarea desde un XML en UTF-16 con BOM, y lo borra al acabar", () => {
    dir = mkdtempSync(join(tmpdir(), "watchdog-"));
    const xmlPath = join(dir, "watchdog-tarea.xml");
    const ahora = new Date(2026, 8, 28, 13, 57);
    const llamadas: string[][] = [];
    const leidos: Buffer[] = [];
    const run: RunSchtasks = (args, done) => {
      llamadas.push(args);
      leidos.push(readFileSync(xmlPath)); // schtasks lo lee en este momento
      done(null);
    };
    const { log, info, error } = fakeLog();

    ensureWatchdogTask(dir, EXE, log, run, ahora);

    expect(llamadas).toEqual([schtasksCreateArgs(xmlPath)]);
    const [bytes = Buffer.alloc(0)] = leidos;
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(bytes.subarray(2).toString("utf16le")).toBe(watchdogTaskXml(EXE, ahora));
    expect(existsSync(xmlPath)).toBe(false);
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
