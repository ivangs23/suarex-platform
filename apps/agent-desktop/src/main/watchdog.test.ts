import { describe, expect, it, vi } from "vitest";
import {
  argsBorrarTarea,
  argsCrearTarea,
  INTERVALO_MINUTOS,
  NOMBRE_TAREA,
  quitarWatchdog,
  registrarWatchdog,
} from "./watchdog.js";

/**
 * Lo que se puede verificar sin un Windows delante: la construcción de los comandos y las
 * garantías de no-romper-nada. La prueba real (que Windows relanza el agente tras matarlo) va
 * en `docs/agent-desktop-validacion.md`, para hacerla en el PC de un cliente.
 */
describe("argsCrearTarea", () => {
  it("entrecomilla la ruta, que en Windows lleva espacios", () => {
    const args = argsCrearTarea("C:\\Program Files\\SuarEx\\agente.exe");
    expect(args).toContain('"C:\\Program Files\\SuarEx\\agente.exe"');
  });

  it("no pide privilegios elevados", () => {
    // En el PC de un restaurante el usuario no suele ser administrador: pedir `/rl highest`
    // haría que la tarea fallara al crearse, en silencio.
    const args = argsCrearTarea("x.exe");
    expect(args[args.indexOf("/rl") + 1]).toBe("limited");
    expect(args).not.toContain("highest");
  });

  it("reemplaza la tarea en vez de acumular o fallar", () => {
    // Se registra en cada arranque; sin `/f`, el segundo arranque fallaría o dejaría dos.
    expect(argsCrearTarea("x.exe")).toContain("/f");
  });

  it("corre cada pocos minutos y solo con sesión iniciada", () => {
    const args = argsCrearTarea("x.exe");
    expect(args[args.indexOf("/mo") + 1]).toBe(String(INTERVALO_MINUTOS));
    // `/it`: sin sesión interactiva no hay cola de impresión ni bandeja, así que arrancarlo
    // sin usuario no serviría de nada.
    expect(args).toContain("/it");
  });

  it("se recupera antes de que salte el aviso a soporte", () => {
    // El barrido del servidor avisa a los 10 min. Si el watchdog tardara más, cada caída
    // breve generaría un aviso que ya no hace falta.
    expect(INTERVALO_MINUTOS).toBeLessThan(10);
  });
});

describe("registrarWatchdog", () => {
  it("no hace nada fuera de Windows", async () => {
    const ejecutar = vi.fn();
    expect(await registrarWatchdog("darwin", "x", ejecutar)).toBe(false);
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it("registra la tarea en Windows", async () => {
    const ejecutar = vi.fn().mockResolvedValue({ code: 0 });
    expect(await registrarWatchdog("win32", "C:\\x.exe", ejecutar)).toBe(true);
    expect(ejecutar).toHaveBeenCalledWith(
      "schtasks",
      expect.arrayContaining(["/create", "/tn", NOMBRE_TAREA]),
    );
  });

  it("NUNCA lanza: perder el watchdog es malo, no imprimir es peor", async () => {
    // Una política de grupo puede prohibir crear tareas. Eso no puede impedir que el agente
    // arranque y siga imprimiendo.
    const revienta = vi.fn().mockRejectedValue(new Error("acceso denegado"));
    await expect(registrarWatchdog("win32", "x", revienta)).resolves.toBe(false);

    const falla = vi.fn().mockResolvedValue({ code: 1 });
    await expect(registrarWatchdog("win32", "x", falla)).resolves.toBe(false);
  });
});

describe("quitarWatchdog", () => {
  it("borra la tarea al des-emparejar", async () => {
    const ejecutar = vi.fn().mockResolvedValue({ code: 0 });
    expect(await quitarWatchdog("win32", ejecutar)).toBe(true);
    expect(ejecutar).toHaveBeenCalledWith("schtasks", argsBorrarTarea());
  });

  it("tampoco lanza si no se puede borrar", async () => {
    // Un PC que ya no es de ningún restaurante no debe quedarse con una tarea huérfana
    // reabriendo la app cada cinco minutos, pero fallar al limpiarla no puede romper el
    // des-emparejamiento.
    const revienta = vi.fn().mockRejectedValue(new Error("no existe"));
    await expect(quitarWatchdog("win32", revienta)).resolves.toBe(false);
  });

  it("no toca nada fuera de Windows", async () => {
    const ejecutar = vi.fn();
    expect(await quitarWatchdog("darwin", ejecutar)).toBe(false);
    expect(ejecutar).not.toHaveBeenCalled();
  });
});
