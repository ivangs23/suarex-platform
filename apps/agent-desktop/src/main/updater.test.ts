import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * EL IMPORT DE electron-updater, PROBADO EN NODE ESM DE VERDAD.
 *
 * El proceso principal es ESM nativo (`"type": "module"`) y electron-updater es CommonJS. Con
 * `import { autoUpdater }` el agente empaquetado moría al arrancar ("Named export 'autoUpdater'
 * not found"), pero SOLO en un build con `UPDATE_FEED_URL`: sin feed, Rollup quitaba el import
 * por código muerto. Vitest no lo ve (resuelve el import con su propio interop), así que aquí se
 * pregunta a un `node` aparte, que es lo que hace Electron.
 */
const enNodeEsm = (codigo: string) =>
  execFileSync(process.execPath, ["--input-type=module", "-e", codigo], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

describe("import de electron-updater", () => {
  it("el import por defecto expone `autoUpdater` (sin tocarlo: es un getter que crea el updater)", () => {
    const salida = enNodeEsm(
      "import u from 'electron-updater'; console.log(Object.getOwnPropertyDescriptor(u, 'autoUpdater') ? 'si' : 'no');",
    );
    expect(salida.trim()).toBe("si");
  });

  it("el import con nombre revienta en ESM nativo: por eso no se usa", () => {
    expect(() => enNodeEsm("import { autoUpdater } from 'electron-updater';")).toThrow(
      /Named export 'autoUpdater' not found/,
    );
  });

  it("updater.ts usa el import por defecto", () => {
    const fuente = readFileSync(new URL("./updater.ts", import.meta.url), "utf8");
    expect(fuente).toMatch(/^import electronUpdater from "electron-updater";$/m);
    expect(fuente).not.toMatch(/import\s*\{[^}]*\}\s*from\s*"electron-updater"/);
  });
});
