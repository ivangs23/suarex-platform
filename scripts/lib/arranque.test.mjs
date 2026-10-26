import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  conValor,
  cuentasDemo,
  EVENTOS_WEBHOOK,
  entornoHijo,
  esClaveDeTest,
  leerEnv,
  matarArbol,
} from "./arranque.mjs";

describe("EVENTOS_WEBHOOK", () => {
  it("son exactamente los que atiende la ruta del webhook", () => {
    // Si la ruta empieza a atender otro evento y aquí no se añade, `stripe listen` no lo
    // reenvía y en local ese camino no se puede probar.
    const ruta = readFileSync(
      join(import.meta.dirname, "../../apps/web/app/api/webhook/stripe/route.ts"),
      "utf8",
    );
    const atendidos = [...ruta.matchAll(/event\.type === "([^"]+)"/g)].map((m) => m[1]);
    expect(atendidos.length).toBeGreaterThan(0);
    expect([...EVENTOS_WEBHOOK].sort()).toEqual([...new Set(atendidos)].sort());
  });
});

describe("leerEnv", () => {
  it("lee CLAVE=valor y se salta comentarios, líneas vacías y comillas", () => {
    const env = leerEnv("# comentario\r\nA=1\n\nB=\"dos\"\nC='tres'\nD=con=igual\n  E = cinco ");
    expect(Object.fromEntries(env)).toEqual({
      A: "1",
      B: "dos",
      C: "tres",
      D: "con=igual",
      E: "cinco",
    });
  });
});

describe("conValor", () => {
  it("sustituye la línea si existe, sin tocar las demás", () => {
    expect(conValor("A=1\nS=viejo\nB=2\n", "S", "nuevo")).toBe("A=1\nS=nuevo\nB=2\n");
  });

  it("la añade al final si no existe", () => {
    expect(conValor("A=1", "S", "nuevo")).toBe("A=1\nS=nuevo\n");
  });

  it("no interpreta `$` del valor como patrón de reemplazo", () => {
    expect(conValor("S=x\n", "S", "a$&b$1")).toBe("S=a$&b$1\n");
  });
});

describe("cuentasDemo", () => {
  it("owner y staff de los dos locales, y el superadmin", () => {
    const env = new Map([
      ["OWNER_SEED_PASSWORD", "o"],
      ["STAFF_SEED_PASSWORD", "s"],
      ["PLATFORM_ADMIN_EMAIL", "superadmin@suarex.local"],
      ["PLATFORM_ADMIN_PASSWORD", "p"],
    ]);
    expect(cuentasDemo(env).map((c) => `${c.email}:${c.password}`)).toEqual([
      "owner@garum.local:o",
      "staff@garum.local:s",
      "owner@manuela.local:o",
      "staff@manuela.local:s",
      "superadmin@suarex.local:p",
    ]);
  });

  it("sin contraseñas sembradas no inventa cuentas", () => {
    expect(cuentasDemo(new Map())).toEqual([]);
  });
});

describe("entornoHijo", () => {
  it("quita una variable con null, sin distinguir mayúsculas", () => {
    // Las terminales de VS Code heredan ELECTRON_RUN_AS_NODE=1: con ella Electron arranca como
    // Node y la app de escritorio muere sin ventana.
    const env = entornoHijo(
      { Electron_Run_As_Node: "1", PATH: "x" },
      { ELECTRON_RUN_AS_NODE: null },
    );
    expect(env).toEqual({ PATH: "x" });
  });

  it("añade y sustituye, sin tocar la base", () => {
    const base = { Path: "x", SUPABASE_URL: "viejo" };
    const env = entornoHijo(base, { SUPABASE_URL: "nuevo", PLATFORM_WEB_ORIGIN: "o" });
    expect(env).toEqual({ Path: "x", SUPABASE_URL: "nuevo", PLATFORM_WEB_ORIGIN: "o" });
    expect(base.SUPABASE_URL).toBe("viejo");
  });
});

describe("esClaveDeTest", () => {
  it("solo acepta claves de test", () => {
    expect(esClaveDeTest("sk_test_abc")).toBe(true);
    expect(esClaveDeTest("rk_test_abc")).toBe(true);
    expect(esClaveDeTest("sk_live_abc")).toBe(false);
    expect(esClaveDeTest(undefined)).toBe(false);
  });
});

describe("matarArbol", () => {
  const vivo = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("mata también a los nietos, no solo al proceso lanzado", async () => {
    // Como `arrancar.mjs`: por la shell (cmd.exe en Windows), que abre un Node que abre otro.
    // Matar solo la shell deja vivo lo de debajo, que es lo que ocupa el puerto.
    const carpeta = mkdtempSync(join(tmpdir(), "arranque-"));
    onTestFinished(() => rmSync(carpeta, { recursive: true, force: true }));
    const lanzador = join(carpeta, "lanzador.cjs");
    writeFileSync(
      lanzador,
      `const nieto = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(nieto.pid);
setInterval(() => {}, 1000);`,
    );
    const padre = spawn(`"${process.execPath}" "${lanzador}"`, {
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pidNieto = await new Promise((resolve) => {
      padre.stdout.once("data", (d) => resolve(Number(String(d).trim())));
    });
    expect(vivo(pidNieto)).toBe(true);

    matarArbol(padre.pid);
    for (let i = 0; i < 50 && (vivo(pidNieto) || vivo(padre.pid)); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(vivo(padre.pid)).toBe(false);
    expect(vivo(pidNieto)).toBe(false);
  }, 15_000);
});
