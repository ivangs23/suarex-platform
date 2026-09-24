import { describe, expect, it } from "vitest";
import { schtasksCreateArgs, WATCHDOG_TASK_NAME, watchdogScript } from "./watchdog.js";

describe("watchdogScript", () => {
  it("solo lanza el exe si NO hay ya un proceso del agente", () => {
    const script = watchdogScript("C:\\Apps\\SuarEx Agente.exe", "SuarEx Agente");
    expect(script).toContain("Get-Process -Name 'SuarEx Agente'");
    expect(script).toContain("Start-Process -FilePath 'C:\\Apps\\SuarEx Agente.exe'");
    // La comprobación va NEGADA: solo arranca si no corre ya.
    expect(script).toContain("if (-not (Get-Process");
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
