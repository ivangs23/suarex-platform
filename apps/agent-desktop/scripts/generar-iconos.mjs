// Genera los iconos de la app a partir de UN dibujo (la marca de SuarEx) en un canvas de
// Chromium:
//   - src/main/iconos-bandeja.ts: la bandeja, uno por nivel de estado (con su punto);
//   - build/icon.ico: el ejecutable, el instalador y el desinstalador;
//   - src/main/icono-app.ts: la ventana, embebido (los avisos toman el del acceso directo).
//
//   node apps/agent-desktop/scripts/generar-iconos.mjs
//
// Usa el Chromium de Playwright (ya está en el monorepo) en vez de una dependencia de imagen.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(aqui, "../../../package.json"));
const { chromium } = require("@playwright/test");

/**
 * La marca, en un lienzo de 32 unidades. La «S» es un trazo, no un carácter de fuente; la
 * cabecera de la ventana (src/renderer/index.html) dibuja el mismo.
 */
const MARCA = {
  fondo: "oklch(0.52 0.19 274)",
  trazo: "oklch(0.985 0.005 274)",
  s: "M21.2 10.6c-1-1.7-2.9-2.8-5.3-2.8-3.1 0-5.3 1.7-5.3 4.1 0 5.6 10.9 3.2 10.9 8.5 0 2.4-2.3 4.1-5.6 4.1-2.5 0-4.6-1.1-5.6-2.9",
};

/** El punto de estado de la bandeja. Los mismos niveles que `src/main/estado.ts`. */
const NIVELES = {
  ok: "oklch(0.74 0.17 152)",
  aviso: "oklch(0.82 0.16 80)",
  error: "oklch(0.62 0.21 27)",
  neutro: "oklch(0.72 0.02 274)",
};

const TAMANOS = [16, 24, 32];
/** Los tamaños que Windows pide al .ico: barra de tareas, Explorador y vistas grandes. */
const TAMANOS_ICO = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const browser = await chromium.launch();
const page = await browser.newPage();
const iconos = await page.evaluate(
  ({ MARCA, NIVELES, TAMANOS, TAMANOS_ICO }) => {
    function dibuja(lado, punto) {
      const c = document.createElement("canvas");
      c.width = lado;
      c.height = lado;
      const ctx = c.getContext("2d");
      ctx.scale(lado / 32, lado / 32);
      ctx.fillStyle = MARCA.fondo;
      ctx.beginPath();
      ctx.roundRect(1, 1, 30, 30, 8);
      ctx.fill();
      ctx.strokeStyle = MARCA.trazo;
      ctx.lineWidth = 3.2;
      ctx.lineCap = "round";
      ctx.stroke(new Path2D(MARCA.s));
      if (punto) {
        ctx.beginPath();
        ctx.arc(25, 25, 6.2, 0, Math.PI * 2);
        ctx.fillStyle = MARCA.trazo;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(25, 25, 4.6, 0, Math.PI * 2);
        ctx.fillStyle = punto;
        ctx.fill();
      }
      return c.toDataURL("image/png").replace("data:image/png;base64,", "");
    }
    const bandeja = {};
    for (const [nivel, color] of Object.entries(NIVELES)) {
      bandeja[nivel] = Object.fromEntries(TAMANOS.map((t) => [t, dibuja(t, color)]));
    }
    const app = Object.fromEntries(TAMANOS_ICO.map((t) => [t, dibuja(t, null)]));
    return { bandeja, app };
  },
  { MARCA, NIVELES, TAMANOS, TAMANOS_ICO },
);
await browser.close();

const ts = `// GENERADO por scripts/generar-iconos.mjs: no se edita a mano.
//
// Icono de la bandeja por nivel de estado (la marca con un punto de color), en PNG base64 a
// 16, 24 y 32 px: 100 %, 150 % y 200 % de escala de Windows. Se embeben para no depender de
// rutas distintas en dev y empaquetado.

import type { Nivel } from "./estado.js";

export const ICONOS_BANDEJA: Record<Nivel, Record<16 | 24 | 32, string>> = ${JSON.stringify(iconos.bandeja, null, 2)};
`;
writeFileSync(join(aqui, "../src/main/iconos-bandeja.ts"), ts);

/** Un .ico con una imagen PNG por tamaño (válido desde Windows Vista). */
function ico(pngs) {
  const cabecera = Buffer.alloc(6 + 16 * pngs.length);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(pngs.length, 4);
  let desplazamiento = cabecera.length;
  pngs.forEach(([lado, datos], i) => {
    const e = 6 + 16 * i;
    cabecera.writeUInt8(lado >= 256 ? 0 : lado, e);
    cabecera.writeUInt8(lado >= 256 ? 0 : lado, e + 1);
    cabecera.writeUInt16LE(1, e + 4);
    cabecera.writeUInt16LE(32, e + 6);
    cabecera.writeUInt32LE(datos.length, e + 8);
    cabecera.writeUInt32LE(desplazamiento, e + 12);
    desplazamiento += datos.length;
  });
  return Buffer.concat([cabecera, ...pngs.map(([, datos]) => datos)]);
}

const png = (lado) => Buffer.from(iconos.app[lado], "base64");
mkdirSync(join(aqui, "../build"), { recursive: true });
writeFileSync(join(aqui, "../build/icon.ico"), ico(TAMANOS_ICO.map((t) => [t, png(t)])));
writeFileSync(
  join(aqui, "../src/main/icono-app.ts"),
  `// GENERADO por scripts/generar-iconos.mjs: no se edita a mano.
//
// El icono de la app (la marca, sin punto de estado) a 256 px, para la ventana. El ejecutable y
// el instalador usan build/icon.ico, que sale del mismo dibujo.

export const ICONO_APP_PNG = "${iconos.app[256]}";
`,
);
// Con el formato del repo, para que regenerar sin cambiar el dibujo no deje diff.
execSync("pnpm exec biome format --write src/main/iconos-bandeja.ts src/main/icono-app.ts", {
  cwd: join(aqui, ".."),
  stdio: "ignore",
});
console.log("src/main/iconos-bandeja.ts, src/main/icono-app.ts, build/icon.ico");
