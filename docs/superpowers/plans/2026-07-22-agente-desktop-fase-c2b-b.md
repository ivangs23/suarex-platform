# App de escritorio del agente — Fase C2b-b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `apps/agent-desktop`, una app Electron para Windows que hospeda `@suarex/agent` (`runAgent`), implementa el sink USB real con koffi+winspool (ESC/POS RAW), enumera impresoras locales, empareja el dispositivo, corre desatendida (auto-arranque + bandeja), tiene una UI diagnóstica (lista de impresoras, botón de impresión de prueba, panel de log), y se empaqueta con un instalador NSIS.

**Architecture:** El proceso main (Node) de Electron hospeda `runAgent` y registra el sink winspool; un renderer mínimo es la UI. Lo arriesgado (el FFI de winspool) se aísla en un fichero tras una frontera inyectable, para probar su *marshalling* headless y dejar solo la llamada real de winspool para la validación en hardware. electron-vite bundlea los paquetes TS del workspace; electron-builder produce el instalador NSIS. Cero migraciones.

**Tech Stack:** Electron, electron-vite, electron-builder (NSIS x64), koffi (FFI a `winspool.drv`), `@suarex/agent`/`@suarex/printing`, TypeScript ESM (Node ≥22.12), Vitest (solo para los módulos testeables headless), Biome.

## AVISO DE VALIDACIÓN (leer antes de empezar)

**Esta fase se construye a ciegas: el entorno de desarrollo es macOS/Linux sin impresora.** NO se puede ejecutar la app Electron, NO se puede cargar el FFI de `winspool.drv` (solo existe en Windows), NO se puede imprimir, NO se puede correr el instalador. En consecuencia, para MUCHAS tareas la "verificación" NO es "tests en verde" sino **`pnpm typecheck` + `pnpm lint` + que `electron-vite build` compile sin error + revisión de código cuidadosa**. Solo tres módulos son testeables headless (pairing, config-store, marshalling del sink); esos sí llevan TDD real. La validación de verdad (winspool real, Electron, instalador) la hace el usuario en el PC Windows 11 del cliente siguiendo `docs/agent-desktop-validacion.md`, entregable de la última tarea. Un implementador que reciba una tarea "ciega" NO debe inventar un test de ejecución; su gate es typecheck/lint/build + el propio plan.

## Global Constraints

- **Prohibido tocar producción.** La app horneada apunta al Supabase de desarrollo durante la validación; el service role JAMÁS se hornea ni viaja en el build. Solo `SUPABASE_URL` + anon key (públicas por diseño, ver `.env.example` y `20260722000001`).
- **El FFI de winspool solo existe en Windows.** Todo el código que carga `winspool.drv` debe ser perezoso y estar tras una frontera inyectable, para que el paquete typechequee y los tests corran en macOS/Linux sin cargarlo. Cargar koffi/winspool solo cuando se va a imprimir de verdad, en `process.platform === "win32"`.
- **El sink real vive en `apps/agent-desktop`, NO en `@suarex/printing`** (que sigue agnóstico de plataforma con solo el hueco `registerUsbRawSink`).
- **La contraseña del device se cifra con `safeStorage` (DPAPI)**; nunca se escribe en claro. `deviceId`/`email`/`tenantId` en JSON en `userData`.
- **Node ≥22.12, ESM, TypeScript strict** (mismas opciones que `tsconfig.base.json`: `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, etc.). Textos de UI en castellano.
- **Auto-update y firma de código: FUERA.** El instalable va sin firmar (se documenta el paso de SmartScreen).
- TDD **solo** para los módulos testeables (pairing, config-store, sink marshalling). Commits frecuentes.

## Comandos del repo

- Instalar deps del nuevo workspace: `pnpm install` (descarga Electron + koffi; es pesado, una vez).
- Typecheck (incluye la app nueva vía turbo): `pnpm typecheck`. Lint: `pnpm lint`.
- Unit de la app: `pnpm --filter @suarex/agent-desktop test`.
- Build de la app (bundle, NO instalador): `pnpm --filter @suarex/agent-desktop build`.
- Empaquetar el instalador: `pnpm --filter @suarex/agent-desktop package` (puede requerir Windows/wine; ver Task 7).

---

## Task 1: Scaffold `apps/agent-desktop` que compila (toolchain + electron-vite)

**Files:**
- Create: `apps/agent-desktop/package.json`
- Create: `apps/agent-desktop/tsconfig.json`
- Create: `apps/agent-desktop/electron.vite.config.ts`
- Create: `apps/agent-desktop/src/main/baked-config.ts`
- Create: `apps/agent-desktop/src/main/index.ts` (mínimo: abre una ventana)
- Create: `apps/agent-desktop/src/preload/index.ts` (vacío/mínimo)
- Create: `apps/agent-desktop/src/renderer/index.html`
- Create: `apps/agent-desktop/src/renderer/main.ts`

**Interfaces:**
- Produces: un workspace `@suarex/agent-desktop` que `pnpm typecheck` y `pnpm --filter @suarex/agent-desktop build` procesan sin error. `baked-config.ts` exporta `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_ORIGIN` leídos de variables `define` de build (con un fallback a `import.meta.env`/proceso para dev).

**Verificación de esta tarea: `pnpm typecheck` + `pnpm lint` + `pnpm --filter @suarex/agent-desktop build`. NO hay ejecución de Electron.** El riesgo real aquí es si electron-vite bundlea los paquetes TS del workspace (`@suarex/agent` exporta `./src/index.ts` con imports `.js`); si el build falla por eso, es el hallazgo temprano que esta tarea existe para provocar.

- [ ] **Step 1: `apps/agent-desktop/package.json`**

```json
{
  "name": "@suarex/agent-desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "build": "electron-vite build",
    "dev": "electron-vite dev",
    "package": "electron-vite build && electron-builder --win --x64",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@suarex/agent": "workspace:*",
    "@suarex/printing": "workspace:*",
    "koffi": "^2.9.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.1.8",
    "electron-vite": "^2.3.0",
    "@types/node": "^26.1.1",
    "typescript": "^5.9.3",
    "vitest": "^4.1.5"
  }
}
```
Nota para el implementador: si alguna versión no resuelve en `pnpm install`, ajústala a la última estable de esa major; deja constancia en el report. `koffi` es una dependencia de RUNTIME (no dev): debe empaquetarse.

- [ ] **Step 2: `apps/agent-desktop/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node", "electron-vite/node"]
  },
  "include": ["src", "electron.vite.config.ts"]
}
```

- [ ] **Step 3: `apps/agent-desktop/electron.vite.config.ts`** — hornea la config pública y asegura que los `@suarex/*` se bundlean (no se externalizan) y que `koffi`/`electron` sí se externalizan.

```ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * `SUPABASE_URL`/`SUPABASE_ANON_KEY` se hornean en tiempo de build vía `define`, leyéndolas
 * de las envs del proceso de build (públicas por diseño; el service role NUNCA se define
 * aquí). En dev se leen de `process.env`; en el build de producción se pasan por la línea
 * de comandos / CI.
 *
 * `externalizeDepsPlugin` mantiene `electron` y `koffi` (nativo) FUERA del bundle -- se
 * cargan desde node_modules empaquetado. Los `@suarex/*` (TS del workspace) SÍ se bundlean:
 * se listan en `resolve` para que Vite los transpile en vez de tratarlos como externos.
 */
const bakedEnv = {
  "import.meta.env.SUPABASE_URL": JSON.stringify(process.env.SUPABASE_URL ?? ""),
  "import.meta.env.SUPABASE_ANON_KEY": JSON.stringify(process.env.SUPABASE_ANON_KEY ?? ""),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@suarex/agent", "@suarex/printing"] })],
    define: bakedEnv,
    build: { rollupOptions: { external: ["koffi"] } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    define: bakedEnv,
  },
});
```
Nota: si electron-vite no bundlea los `@suarex/*` (error "cannot resolve" o `.js` no encontrado), añade un alias en `resolve.alias` apuntando a `../../packages/<pkg>/src/index.ts`, o un plugin que reescriba las extensiones `.js`→`.ts`. Documenta lo que haya hecho falta; este es el punto de integración más incierto de toda la fase.

- [ ] **Step 4: `apps/agent-desktop/src/main/baked-config.ts`**

```ts
/**
 * Config pública horneada en el build (ver `electron.vite.config.ts`). La anon key es
 * pública por diseño (RLS acota lo que ve cada usuario); el service role JAMÁS llega aquí.
 * `SUPABASE_ORIGIN` es el origin del que cuelga `/api/devices/pair` -- por defecto, el mismo
 * de la web del tenant/plataforma; se deriva de `SUPABASE_URL` si no se hornea aparte.
 */
export const SUPABASE_URL: string = import.meta.env.SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string = import.meta.env.SUPABASE_ANON_KEY ?? "";

/** El endpoint de emparejamiento vive en la web de la plataforma, no en el propio Supabase.
 * Se hornea como `SUPABASE_URL` de la web (p. ej. https://garum.suarex.app) durante el
 * build; en dev, http://garum.localhost:3000. Se toma de una env aparte para no acoplarlo a
 * la URL de Supabase. */
export const PAIR_ENDPOINT_ORIGIN: string = import.meta.env.SUPABASE_URL ?? "";
```
Nota: en la práctica el origin del endpoint de pairing (la web Next) puede diferir de la URL de Supabase; el implementador puede separar la env (`PAIR_ORIGIN`) si en Task 5 se ve que hacen falta dos valores. Para el scaffold basta con exponerlas.

- [ ] **Step 5: main mínimo** — `apps/agent-desktop/src/main/index.ts`:

```ts
import { app, BrowserWindow } from "electron";
import { join } from "node:path";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 720,
    height: 560,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (import.meta.env.DEV) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL as string);
  } else {
    win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

`apps/agent-desktop/src/preload/index.ts`:
```ts
// Puente contextBridge -- se rellena en Task 6. Vacío en el scaffold.
export {};
```

`apps/agent-desktop/src/renderer/index.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>SuarEx — Agente de impresión</title>
  </head>
  <body>
    <h1>SuarEx — Agente de impresión</h1>
    <div id="app"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`apps/agent-desktop/src/renderer/main.ts`:
```ts
const el = document.getElementById("app");
if (el) el.textContent = "Cargando…";
```

- [ ] **Step 6: Instalar + verificar build/typecheck/lint**

Run: `pnpm install && pnpm typecheck && pnpm lint && pnpm --filter @suarex/agent-desktop build`
Expected: `pnpm install` enlaza el workspace y descarga electron/koffi; typecheck/lint limpios; `electron-vite build` produce `out/main`, `out/preload`, `out/renderer` sin error. **Si el build falla al resolver `@suarex/*`, ese es el hallazgo clave** — ajusta el config de electron-vite (Step 3 nota) y deja constancia. NO se ejecuta Electron.

- [ ] **Step 7: Commit**

```bash
git add apps/agent-desktop pnpm-lock.yaml
git commit -m "feat(agent-desktop): scaffold Electron app (electron-vite, baked config, builds clean)"
```

---

## Task 2: `pairing.ts` — emparejamiento HTTP (TDD real)

**Files:**
- Create: `apps/agent-desktop/src/main/pairing.ts`
- Test: `apps/agent-desktop/src/main/pairing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PairResult = { deviceId: string; email: string; password: string; tenantId: string };
  export type PairError = { kind: "invalid-code" | "rate-limited" | "network" };
  export async function pairDevice(origin: string, pairingCode: string, fetchFn?: typeof fetch): Promise<PairResult>;
  ```
  `pairDevice` hace `POST ${origin}/api/devices/pair` con `{ pairingCode }`. 200 → `PairResult`; 404 → lanza `PairError{kind:"invalid-code"}`; 429 → `PairError{kind:"rate-limited"}`; fallo de red / otro → `PairError{kind:"network"}`. `fetchFn` inyectable (por defecto el `fetch` global) para testear.

- [ ] **Step 1: Escribir el test que falla** — `apps/agent-desktop/src/main/pairing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pairDevice } from "./pairing.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("pairDevice", () => {
  it("200 devuelve las credenciales", async () => {
    const f = fakeFetch(200, { deviceId: "d1", email: "e@x", password: "p", tenantId: "t1" });
    const r = await pairDevice("http://host", "CODE", f);
    expect(r).toEqual({ deviceId: "d1", email: "e@x", password: "p", tenantId: "t1" });
  });

  it("404 lanza invalid-code", async () => {
    await expect(pairDevice("http://host", "X", fakeFetch(404, { error: "x" }))).rejects.toMatchObject({
      kind: "invalid-code",
    });
  });

  it("429 lanza rate-limited", async () => {
    await expect(pairDevice("http://host", "X", fakeFetch(429, { error: "x" }))).rejects.toMatchObject({
      kind: "rate-limited",
    });
  });

  it("un fallo de red lanza network", async () => {
    const f = (async () => {
      throw new Error("boom");
    }) as typeof fetch;
    await expect(pairDevice("http://host", "X", f)).rejects.toMatchObject({ kind: "network" });
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm --filter @suarex/agent-desktop test`
Expected: FAIL (`pairing.js` no existe).

- [ ] **Step 3: Implementar `apps/agent-desktop/src/main/pairing.ts`**

```ts
export type PairResult = { deviceId: string; email: string; password: string; tenantId: string };
export type PairError = { kind: "invalid-code" | "rate-limited" | "network" };

function pairError(kind: PairError["kind"]): PairError {
  return { kind };
}

/**
 * Empareja el dispositivo contra `POST ${origin}/api/devices/pair`. El endpoint colapsa
 * cualquier código inválido/caducado a 404 (oráculo uniforme, ver el route de la web) y
 * un exceso de intentos a 429 (rate-limit de C2a). `fetchFn` se inyecta para los tests.
 */
export async function pairDevice(
  origin: string,
  pairingCode: string,
  fetchFn: typeof fetch = fetch,
): Promise<PairResult> {
  let res: Response;
  try {
    res = await fetchFn(`${origin}/api/devices/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingCode }),
    });
  } catch {
    throw pairError("network");
  }

  if (res.status === 404) throw pairError("invalid-code");
  if (res.status === 429) throw pairError("rate-limited");
  if (!res.ok) throw pairError("network");

  try {
    const data = (await res.json()) as Partial<PairResult>;
    if (!data.deviceId || !data.email || !data.password || !data.tenantId) {
      throw pairError("network");
    }
    return { deviceId: data.deviceId, email: data.email, password: data.password, tenantId: data.tenantId };
  } catch {
    throw pairError("network");
  }
}
```

- [ ] **Step 4: Ejecutar y ver pasar + typecheck**

Run: `pnpm --filter @suarex/agent-desktop test && pnpm typecheck`
Expected: PASS (4 casos).

- [ ] **Step 5: Commit**

```bash
git add apps/agent-desktop/src/main/pairing.ts apps/agent-desktop/src/main/pairing.test.ts
git commit -m "feat(agent-desktop): device pairing HTTP client (typed 404/429/network)"
```

---

## Task 3: `config-store.ts` — credenciales cifradas (TDD real)

**Files:**
- Create: `apps/agent-desktop/src/main/config-store.ts`
- Test: `apps/agent-desktop/src/main/config-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StoredCredentials = { deviceId: string; email: string; password: string; tenantId: string };
  export type ConfigBackend = {
    read(): string | null;              // lee el JSON crudo o null si no existe
    write(raw: string): void;           // escribe el JSON crudo
    encrypt(plain: string): string;     // cifra (safeStorage/DPAPI en prod)
    decrypt(enc: string): string;       // descifra
  };
  export function saveCredentials(backend: ConfigBackend, creds: StoredCredentials): void;
  export function loadCredentials(backend: ConfigBackend): StoredCredentials | null;
  ```
  La contraseña se guarda cifrada (base64 del `encrypt`); `deviceId`/`email`/`tenantId` en claro en el JSON. `loadCredentials` devuelve `null` si no hay fichero (no emparejado) y descifra la contraseña al leer. La lógica es pura sobre `ConfigBackend`; en producción (Task 5) el backend se implementa con `safeStorage` + FS en `userData`.

- [ ] **Step 1: Escribir el test que falla** — `apps/agent-desktop/src/main/config-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type ConfigBackend, loadCredentials, saveCredentials } from "./config-store.js";

/** Backend falso en memoria: `encrypt` marca el texto para verificar que la contraseña
 * NUNCA se escribe en claro. */
function fakeBackend(): ConfigBackend & { stored: string | null } {
  const state = { stored: null as string | null };
  return {
    stored: state.stored,
    read: () => state.stored,
    write: (raw) => {
      state.stored = raw;
    },
    encrypt: (plain) => `ENC(${plain})`,
    decrypt: (enc) => enc.replace(/^ENC\((.*)\)$/, "$1"),
    get storedRef() {
      return state.stored;
    },
  } as ConfigBackend & { stored: string | null };
}

describe("config-store", () => {
  it("guarda y lee credenciales (round-trip), con la contraseña cifrada", () => {
    const b = fakeBackend();
    saveCredentials(b, { deviceId: "d1", email: "e@x", password: "secreta", tenantId: "t1" });

    // La contraseña NO aparece en claro en el JSON guardado.
    const raw = b.read() as string;
    expect(raw).not.toContain("secreta");
    expect(raw).toContain("ENC(secreta)");

    const loaded = loadCredentials(b);
    expect(loaded).toEqual({ deviceId: "d1", email: "e@x", password: "secreta", tenantId: "t1" });
  });

  it("loadCredentials devuelve null si no hay fichero (no emparejado)", () => {
    const b = fakeBackend();
    expect(loadCredentials(b)).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm --filter @suarex/agent-desktop test`
Expected: FAIL (`config-store.js` no existe).

- [ ] **Step 3: Implementar `apps/agent-desktop/src/main/config-store.ts`**

```ts
export type StoredCredentials = { deviceId: string; email: string; password: string; tenantId: string };

export type ConfigBackend = {
  read(): string | null;
  write(raw: string): void;
  encrypt(plain: string): string;
  decrypt(enc: string): string;
};

type OnDisk = { deviceId: string; email: string; tenantId: string; passwordEnc: string };

/** Guarda las credenciales: la contraseña cifrada (`encrypt` -> `passwordEnc`), el resto en
 * claro. En producción `encrypt` es `safeStorage` (DPAPI), así que la contraseña queda
 * ligada al usuario/máquina y nunca se escribe en claro. */
export function saveCredentials(backend: ConfigBackend, creds: StoredCredentials): void {
  const onDisk: OnDisk = {
    deviceId: creds.deviceId,
    email: creds.email,
    tenantId: creds.tenantId,
    passwordEnc: backend.encrypt(creds.password),
  };
  backend.write(JSON.stringify(onDisk));
}

/** Lee y descifra las credenciales, o `null` si no hay fichero (dispositivo no emparejado)
 * o el JSON está corrupto. */
export function loadCredentials(backend: ConfigBackend): StoredCredentials | null {
  const raw = backend.read();
  if (raw === null) return null;
  try {
    const onDisk = JSON.parse(raw) as Partial<OnDisk>;
    if (!onDisk.deviceId || !onDisk.email || !onDisk.tenantId || !onDisk.passwordEnc) return null;
    return {
      deviceId: onDisk.deviceId,
      email: onDisk.email,
      tenantId: onDisk.tenantId,
      password: backend.decrypt(onDisk.passwordEnc),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Ejecutar y ver pasar + typecheck**

Run: `pnpm --filter @suarex/agent-desktop test && pnpm typecheck`
Expected: PASS (2 casos).

- [ ] **Step 5: Commit**

```bash
git add apps/agent-desktop/src/main/config-store.ts apps/agent-desktop/src/main/config-store.test.ts
git commit -m "feat(agent-desktop): config-store (encrypted password over injectable backend)"
```

---

## Task 4: `usb-sink-winspool.ts` — sink USB (marshalling TDD + FFI aislado)

**Files:**
- Create: `apps/agent-desktop/src/main/usb-sink-winspool.ts`
- Test: `apps/agent-desktop/src/main/usb-sink-winspool.test.ts`

**Interfaces:**
- Consumes: `UsbRawSink` (`@suarex/printing`).
- Produces:
  ```ts
  export type WinspoolBinding = {
    // Devuelve un handle opaco de impresora o lanza si no se pudo abrir.
    openPrinter(printerName: string): unknown;
    // Manda el buffer como un doc RAW; devuelve el nº de bytes escritos. Cierra el doc.
    writeRawDoc(handle: unknown, docName: string, buffer: Buffer): number;
    closePrinter(handle: unknown): void;
  };
  export function makeUsbSink(binding: WinspoolBinding): UsbRawSink;
  export function loadWinspoolBinding(): WinspoolBinding; // real, koffi -- solo win32
  ```
  `makeUsbSink(binding)` devuelve un `UsbRawSink` `(buffer, printerName) => Promise<void>` que abre, escribe RAW, comprueba que se escribieron TODOS los bytes (si no, lanza), y cierra en un `finally`. `loadWinspoolBinding` es la implementación real con koffi contra `winspool.drv` (solo se invoca en Windows, en Task 5). Los tests inyectan un binding falso.

- [ ] **Step 1: Escribir el test que falla** — `apps/agent-desktop/src/main/usb-sink-winspool.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeUsbSink, type WinspoolBinding } from "./usb-sink-winspool.js";

function fakeBinding(overrides: Partial<WinspoolBinding> = {}): WinspoolBinding & {
  calls: { openedWith: string[]; wrote: Buffer[]; closed: number };
} {
  const calls = { openedWith: [] as string[], wrote: [] as Buffer[], closed: 0 };
  const base: WinspoolBinding = {
    openPrinter: (name) => {
      calls.openedWith.push(name);
      return { handle: name };
    },
    writeRawDoc: (_h, _doc, buf) => {
      calls.wrote.push(buf);
      return buf.length; // todos los bytes por defecto
    },
    closePrinter: () => {
      calls.closed += 1;
    },
    ...overrides,
  };
  return Object.assign(base, { calls });
}

const buffer = Buffer.from([0x1b, 0x40, 0x41]); // ESC @ A

describe("makeUsbSink", () => {
  it("abre la impresora por nombre, escribe el buffer exacto y cierra", async () => {
    const b = fakeBinding();
    const sink = makeUsbSink(b);
    await sink(buffer, "EPSON TM-T20");
    expect(b.calls.openedWith).toEqual(["EPSON TM-T20"]);
    expect(b.calls.wrote).toHaveLength(1);
    expect(b.calls.wrote[0]?.equals(buffer)).toBe(true);
    expect(b.calls.closed).toBe(1);
  });

  it("lanza (y cierra igual) si se escriben menos bytes de los pedidos", async () => {
    const b = fakeBinding({ writeRawDoc: (_h, _d, buf) => buf.length - 1 });
    const sink = makeUsbSink(b);
    await expect(sink(buffer, "P")).rejects.toThrow(/bytes/i);
    expect(b.calls.closed).toBe(1); // cerró pese al fallo
  });

  it("si openPrinter lanza, propaga y no intenta cerrar un handle inexistente", async () => {
    const b = fakeBinding({
      openPrinter: () => {
        throw new Error("no existe la impresora");
      },
    });
    const sink = makeUsbSink(b);
    await expect(sink(buffer, "NOPE")).rejects.toThrow(/impresora/i);
    expect(b.calls.closed).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm --filter @suarex/agent-desktop test`
Expected: FAIL (`usb-sink-winspool.js` no existe).

- [ ] **Step 3: Implementar `apps/agent-desktop/src/main/usb-sink-winspool.ts`**

```ts
import type { UsbRawSink } from "@suarex/printing";

/**
 * Frontera inyectable sobre winspool: la LÓGICA del sink (abrir → escribir todo → cerrar,
 * y tratar un write parcial como fallo) se prueba headless con un binding falso; la
 * implementación REAL (`loadWinspoolBinding`, koffi) solo se carga y ejerce en Windows.
 */
export type WinspoolBinding = {
  openPrinter(printerName: string): unknown;
  writeRawDoc(handle: unknown, docName: string, buffer: Buffer): number;
  closePrinter(handle: unknown): void;
};

const DOC_NAME = "SuarEx ticket";

/** Compone un `UsbRawSink` a partir de un binding. Cierra SIEMPRE (finally) si se llegó a
 * abrir; un write parcial (menos bytes de los pedidos) es un fallo. */
export function makeUsbSink(binding: WinspoolBinding): UsbRawSink {
  return async (buffer: Buffer, printerName: string): Promise<void> => {
    const handle = binding.openPrinter(printerName); // lanza si no se pudo abrir
    try {
      const written = binding.writeRawDoc(handle, DOC_NAME, buffer);
      if (written !== buffer.length) {
        throw new Error(
          `impresión USB incompleta: se escribieron ${written} de ${buffer.length} bytes`,
        );
      }
    } finally {
      binding.closePrinter(handle);
    }
  };
}

/**
 * Binding REAL con koffi contra `winspool.drv`. SOLO se invoca en Windows (Task 5 lo llama
 * tras comprobar `process.platform === "win32"`). Se importa koffi de forma perezosa dentro
 * de la función para que este módulo se pueda importar y typecheckear en macOS/Linux sin
 * cargar el binario nativo. La secuencia RAW es OpenPrinterW → StartDocPrinterW(datatype
 * "RAW") → StartPagePrinter → WritePrinter → EndPagePrinter → EndDocPrinter → ClosePrinter.
 *
 * NOTA DE VALIDACIÓN: esta es la parte más incierta de la fase; la firma exacta de las
 * funciones koffi (out-params, structs) puede necesitar ajuste en el PC Windows real. El
 * botón "Imprimir ticket de prueba" (Task 6) la ejercita de forma aislada.
 */
export function loadWinspoolBinding(): WinspoolBinding {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- carga perezosa del nativo
  const koffi = require("koffi") as typeof import("koffi");
  const winspool = koffi.load("winspool.drv");

  const DOC_INFO_1W = koffi.struct("DOC_INFO_1W", {
    pDocName: "str16",
    pOutputFile: "str16",
    pDatatype: "str16",
  });

  const OpenPrinterW = winspool.func(
    "int __stdcall OpenPrinterW(str16 pPrinterName, _Out_ void **phPrinter, void *pDefault)",
  );
  const StartDocPrinterW = winspool.func(
    "uint32 __stdcall StartDocPrinterW(void *hPrinter, uint32 Level, DOC_INFO_1W *pDocInfo)",
  );
  const StartPagePrinter = winspool.func("int __stdcall StartPagePrinter(void *hPrinter)");
  const WritePrinter = winspool.func(
    "int __stdcall WritePrinter(void *hPrinter, void *pBuf, uint32 cbBuf, _Out_ uint32 *pcWritten)",
  );
  const EndPagePrinter = winspool.func("int __stdcall EndPagePrinter(void *hPrinter)");
  const EndDocPrinter = winspool.func("int __stdcall EndDocPrinter(void *hPrinter)");
  const ClosePrinter = winspool.func("int __stdcall ClosePrinter(void *hPrinter)");

  return {
    openPrinter(printerName: string): unknown {
      const out: unknown[] = [null];
      const ok = OpenPrinterW(printerName, out, null);
      if (!ok || !out[0]) throw new Error(`no se pudo abrir la impresora "${printerName}"`);
      return out[0];
    },
    writeRawDoc(handle: unknown, docName: string, buffer: Buffer): number {
      const job = StartDocPrinterW(handle, 1, {
        pDocName: docName,
        pOutputFile: null,
        pDatatype: "RAW",
      });
      if (job === 0) throw new Error("StartDocPrinter falló");
      if (!StartPagePrinter(handle)) throw new Error("StartPagePrinter falló");
      const written: number[] = [0];
      const ok = WritePrinter(handle, buffer, buffer.length, written);
      EndPagePrinter(handle);
      EndDocPrinter(handle);
      if (!ok) throw new Error("WritePrinter falló");
      return written[0] ?? 0;
    },
    closePrinter(handle: unknown): void {
      ClosePrinter(handle);
    },
  };
}
```
Nota: `DOC_INFO_1W` se declara para documentar la estructura; según la versión de koffi puede que `StartDocPrinterW` acepte el objeto literal directamente (como arriba) o requiera `koffi.as`. El implementador deja el código plausible; el ajuste fino es parte de la validación en Windows. `require` se usa a propósito para la carga perezosa del nativo (koffi es CommonJS); si `verbatimModuleSyntax`/ESM lo impide, usar `const koffi = (await import("koffi")).default` y hacer `loadWinspoolBinding` async (ajustando Task 5).

- [ ] **Step 4: Ejecutar y ver pasar + typecheck + lint**

Run: `pnpm --filter @suarex/agent-desktop test && pnpm typecheck && pnpm lint`
Expected: PASS (3 casos de marshalling). El `loadWinspoolBinding` NO se ejecuta en el test (solo `makeUsbSink` con el binding falso), así que koffi/winspool no se cargan en macOS/Linux.

- [ ] **Step 5: Commit**

```bash
git add apps/agent-desktop/src/main/usb-sink-winspool.ts apps/agent-desktop/src/main/usb-sink-winspool.test.ts
git commit -m "feat(agent-desktop): USB sink over injectable winspool binding (RAW) + marshalling tests"
```

---

## Task 5: Enumerar impresoras + agent-runner + IPC (glue, verificación build)

**Files:**
- Create: `apps/agent-desktop/src/main/printers.ts`
- Create: `apps/agent-desktop/src/main/agent-runner.ts`
- Create: `apps/agent-desktop/src/main/real-config-backend.ts`
- Create: `apps/agent-desktop/src/main/ipc.ts`

**Interfaces:**
- Consumes: `runAgent` (`@suarex/agent`), `registerUsbRawSink`, `renderEscPos` (`@suarex/printing`), `makeUsbSink`/`loadWinspoolBinding` (Task 4), `pairDevice` (Task 2), `saveCredentials`/`loadCredentials`/`ConfigBackend` (Task 3), `PAIR_ENDPOINT_ORIGIN`/`SUPABASE_URL`/`SUPABASE_ANON_KEY` (Task 1).
- Produces: `agent-runner.ts` con `startAgent(creds)`/`stopAgent()` que registra el sink real (solo en win32) y llama a `runAgent`; `printers.ts` con `listLocalPrinters(win)` (Electron `getPrintersAsync`) y `printTestTicket(printerName)`; `real-config-backend.ts` con un `ConfigBackend` sobre `safeStorage` + FS en `userData`; `ipc.ts` que registra los handlers `ipcMain.handle` (`pair`, `list-printers`, `test-print`, `get-status`, `unpair`).

**Verificación de esta tarea: `pnpm typecheck` + `pnpm lint` + `pnpm --filter @suarex/agent-desktop build`. NO hay ejecución (Electron/safeStorage/winspool no corren aquí).** El gate es que compile y la revisión.

- [ ] **Step 1: `real-config-backend.ts`** — el `ConfigBackend` de producción:

```ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { ConfigBackend } from "./config-store.js";

/** Backend de producción: JSON en `userData/credentials.json`, contraseña cifrada con
 * `safeStorage` (DPAPI en Windows). `encrypt`/`decrypt` usan base64 para poder guardar el
 * buffer cifrado como texto en el JSON. */
export function realConfigBackend(): ConfigBackend {
  const file = join(app.getPath("userData"), "credentials.json");
  return {
    read: () => (existsSync(file) ? readFileSync(file, "utf8") : null),
    write: (raw) => writeFileSync(file, raw, "utf8"),
    encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
    decrypt: (enc) => safeStorage.decryptString(Buffer.from(enc, "base64")),
  };
}
```

- [ ] **Step 2: `printers.ts`** — enumerar + ticket de prueba:

```ts
import type { BrowserWindow } from "electron";
import { registerUsbRawSink, renderEscPos } from "@suarex/printing";
import { loadWinspoolBinding, makeUsbSink } from "./usb-sink-winspool.js";

/** Impresoras instaladas en Windows, por su `name` (el que el owner teclea en el panel).
 * Usa la API nativa de Electron -- sin FFI. */
export async function listLocalPrinters(win: BrowserWindow): Promise<string[]> {
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((p) => p.name);
}

/** Un ticket ESC/POS fijo de prueba: cabecera + línea + corte. Ejercita el camino RAW sin
 * la nube ni un pedido. Solo en Windows; en otra plataforma lanza para que la UI lo diga. */
export async function printTestTicket(printerName: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("La impresión USB solo está disponible en Windows.");
  }
  registerUsbRawSink(makeUsbSink(loadWinspoolBinding()));
  const bytes = renderEscPos([
    { kind: "text", text: "SUAREX", align: "center", bold: true },
    { kind: "text", text: "Ticket de prueba", align: "center" },
    { kind: "text", text: new Date().toISOString(), align: "left" },
    { kind: "cut" },
  ]);
  // La entrega va por el sink registrado; se usa el sink directamente para no depender del
  // dispatch de printToPrinter (que necesita una PrinterConfig completa).
  const sink = makeUsbSink(loadWinspoolBinding());
  await sink(bytes, printerName);
}
```
Nota: `TicketLine` viene de `@suarex/ticket` vía `renderEscPos`; si el tipo exige más campos, ajústalo a la forma real de `TicketLine` (ver `packages/ticket/src/types.ts`, el mismo que usa `escpos-tcp.test.ts`).

- [ ] **Step 3: `agent-runner.ts`** — registrar sink + runAgent:

```ts
import { registerUsbRawSink } from "@suarex/printing";
import { runAgent } from "@suarex/agent";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./baked-config.js";
import type { StoredCredentials } from "./config-store.js";
import { loadWinspoolBinding, makeUsbSink } from "./usb-sink-winspool.js";

let stop: (() => void) | null = null;

/** Arranca el agente con las credenciales guardadas: registra el sink USB real (solo en
 * Windows; en otra plataforma el sink por defecto de `@suarex/printing` ya falla limpio y el
 * agente solo podría imprimir por red) y llama a `runAgent`. Guarda la función de parada. */
export async function startAgent(creds: StoredCredentials): Promise<void> {
  if (process.platform === "win32") {
    registerUsbRawSink(makeUsbSink(loadWinspoolBinding()));
  }
  stop = await runAgent({
    supabaseUrl: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    email: creds.email,
    password: creds.password,
  });
}

/** Detiene el agente si está corriendo (lo llama el cierre de la app / el des-emparejar). */
export function stopAgent(): void {
  if (stop) {
    stop();
    stop = null;
  }
}

export function isAgentRunning(): boolean {
  return stop !== null;
}
```

- [ ] **Step 4: `ipc.ts`** — handlers entre renderer y main:

```ts
import { type BrowserWindow, ipcMain } from "electron";
import { PAIR_ENDPOINT_ORIGIN } from "./baked-config.js";
import { loadCredentials, saveCredentials } from "./config-store.js";
import { pairDevice } from "./pairing.js";
import { listLocalPrinters, printTestTicket } from "./printers.js";
import { realConfigBackend } from "./real-config-backend.js";
import { isAgentRunning, startAgent, stopAgent } from "./agent-runner.js";

/** Registra los canales IPC. El renderer nunca toca Node/Electron directo: todo pasa por
 * estos handlers vía el puente contextBridge del preload. */
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("list-printers", async () => {
    const win = getWindow();
    return win ? listLocalPrinters(win) : [];
  });

  ipcMain.handle("pair", async (_e, pairingCode: string) => {
    const creds = await pairDevice(PAIR_ENDPOINT_ORIGIN, pairingCode); // lanza PairError tipado
    saveCredentials(realConfigBackend(), creds);
    await startAgent(creds);
    return { deviceId: creds.deviceId, tenantId: creds.tenantId };
  });

  ipcMain.handle("test-print", async (_e, printerName: string) => {
    await printTestTicket(printerName);
    return { ok: true };
  });

  ipcMain.handle("get-status", async () => {
    const creds = loadCredentials(realConfigBackend());
    return { paired: creds !== null, running: isAgentRunning(), deviceId: creds?.deviceId ?? null };
  });

  ipcMain.handle("unpair", async () => {
    stopAgent();
    realConfigBackend().write(JSON.stringify({})); // deja el store vacío -> loadCredentials null
    return { ok: true };
  });
}
```

- [ ] **Step 5: Verificar typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @suarex/agent-desktop build`
Expected: PASS (compila y bundlea). Recuerda: NO se ejecuta nada. Revisa a conciencia que el sink solo se registra en win32, que ningún secreto se hornea, y que el renderer no importa módulos de `main`.

- [ ] **Step 6: Commit**

```bash
git add apps/agent-desktop/src/main/printers.ts apps/agent-desktop/src/main/agent-runner.ts apps/agent-desktop/src/main/real-config-backend.ts apps/agent-desktop/src/main/ipc.ts
git commit -m "feat(agent-desktop): printer enumeration, agent runner, config backend, IPC glue"
```

---

## Task 6: Cáscara Electron — lifecycle desatendido + preload + UI diagnóstica

**Files:**
- Modify: `apps/agent-desktop/src/main/index.ts`
- Modify: `apps/agent-desktop/src/preload/index.ts`
- Modify: `apps/agent-desktop/src/renderer/index.html`
- Modify: `apps/agent-desktop/src/renderer/main.ts`

**Interfaces:**
- Consumes: `registerIpc` (Task 5), `loadCredentials`/`realConfigBackend`/`startAgent` (Tasks 3/5).
- Produces: el main completo (single-instance, tray, auto-launch, cerrar-a-bandeja, arranque del agente si emparejado), el preload con el puente `contextBridge`, y la UI (emparejar, estado, lista de impresoras, botón de test, panel de log).

**Verificación de esta tarea: `pnpm typecheck` + `pnpm lint` + `pnpm --filter @suarex/agent-desktop build`. NO hay ejecución de Electron aquí — la cáscara la valida el usuario en Windows (Task 7 checklist).** El gate es compilar + revisión.

- [ ] **Step 1: main completo** — `apps/agent-desktop/src/main/index.ts`:

```ts
import { app, BrowserWindow, Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
import { registerIpc } from "./ipc.js";
import { loadCredentials } from "./config-store.js";
import { realConfigBackend } from "./real-config-backend.js";
import { startAgent, stopAgent } from "./agent-runner.js";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

/** Single-instance: una segunda ejecución enfoca la existente en vez de abrir otra. */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Auto-arranque en el login de Windows (desatendido).
    app.setLoginItemSettings({ openAtLogin: true });

    createWindow();
    createTray();
    registerIpc(() => mainWindow);

    // Si ya está emparejado, arranca el agente al iniciar (imprime sin abrir la ventana).
    const creds = loadCredentials(realConfigBackend());
    if (creds) {
      await startAgent(creds).catch((e) => console.error("[agent-desktop] no se pudo arrancar el agente:", e));
    }
  });

  app.on("before-quit", () => {
    quitting = true;
    stopAgent();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 620,
    show: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Cerrar la ventana la oculta a la bandeja (no cierra la app) salvo que estemos saliendo.
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  if (import.meta.env.DEV) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL as string);
  } else {
    mainWindow.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

function createTray(): void {
  // Un icono vacío de 16x16 basta para el scaffold; se reemplaza por el real en el empaquetado.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("SuarEx — Agente de impresión");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir", click: () => mainWindow?.show() },
      { type: "separator" },
      {
        label: "Salir",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => mainWindow?.show());
}
```

- [ ] **Step 2: preload** — `apps/agent-desktop/src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

/** Puente seguro: el renderer solo ve estas funciones, nunca Node/Electron directo
 * (contextIsolation + nodeIntegration:false). Cada una invoca un handler `ipcMain.handle`. */
contextBridge.exposeInMainWorld("agent", {
  listPrinters: (): Promise<string[]> => ipcRenderer.invoke("list-printers"),
  pair: (code: string): Promise<{ deviceId: string; tenantId: string }> => ipcRenderer.invoke("pair", code),
  testPrint: (printerName: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("test-print", printerName),
  getStatus: (): Promise<{ paired: boolean; running: boolean; deviceId: string | null }> =>
    ipcRenderer.invoke("get-status"),
  unpair: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("unpair"),
});
```

- [ ] **Step 3: UI** — `apps/agent-desktop/src/renderer/index.html` (estructura) y `main.ts` (lógica). `index.html`:

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>SuarEx — Agente de impresión</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 1.5rem; }
      section { margin-bottom: 1.25rem; }
      #log { white-space: pre-wrap; background: #111; color: #0f0; padding: .75rem; height: 12rem; overflow: auto; font-family: monospace; }
      button { margin: .25rem 0; }
    </style>
  </head>
  <body>
    <h1>SuarEx — Agente de impresión</h1>
    <section id="status">Estado: cargando…</section>
    <section>
      <h2>Emparejamiento</h2>
      <input id="code" placeholder="Código de emparejamiento" />
      <button id="pair">Emparejar</button>
      <button id="unpair">Des-emparejar</button>
    </section>
    <section>
      <h2>Impresoras locales</h2>
      <select id="printers"></select>
      <button id="refresh">Actualizar lista</button>
      <button id="test">Imprimir ticket de prueba</button>
    </section>
    <section>
      <h2>Registro</h2>
      <div id="log"></div>
    </section>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`apps/agent-desktop/src/renderer/main.ts`:
```ts
type AgentApi = {
  listPrinters(): Promise<string[]>;
  pair(code: string): Promise<{ deviceId: string; tenantId: string }>;
  testPrint(printerName: string): Promise<{ ok: boolean }>;
  getStatus(): Promise<{ paired: boolean; running: boolean; deviceId: string | null }>;
  unpair(): Promise<{ ok: boolean }>;
};
const agent = (window as unknown as { agent: AgentApi }).agent;

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const logEl = $("log");
function log(msg: string): void {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

async function refreshStatus(): Promise<void> {
  const s = await agent.getStatus();
  $("status").textContent = `Estado: ${s.paired ? "emparejado" : "sin emparejar"} · agente ${s.running ? "corriendo" : "parado"}${s.deviceId ? ` · dispositivo ${s.deviceId}` : ""}`;
}

async function refreshPrinters(): Promise<void> {
  const printers = await agent.listPrinters();
  const sel = $("printers") as HTMLSelectElement;
  sel.innerHTML = "";
  for (const name of printers) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  log(`Impresoras detectadas: ${printers.length ? printers.join(", ") : "(ninguna)"}`);
}

$("pair").addEventListener("click", async () => {
  const code = ($("code") as HTMLInputElement).value.trim();
  if (!code) return;
  try {
    const r = await agent.pair(code);
    log(`Emparejado: dispositivo ${r.deviceId}, tenant ${r.tenantId}`);
    await refreshStatus();
  } catch (e) {
    const kind = (e as { kind?: string }).kind;
    log(`Error al emparejar: ${kind === "invalid-code" ? "código inválido o caducado" : kind === "rate-limited" ? "demasiados intentos, espera" : "fallo de red"}`);
  }
});

$("unpair").addEventListener("click", async () => {
  await agent.unpair();
  log("Des-emparejado.");
  await refreshStatus();
});

$("refresh").addEventListener("click", refreshPrinters);

$("test").addEventListener("click", async () => {
  const name = ($("printers") as HTMLSelectElement).value;
  if (!name) {
    log("Selecciona una impresora primero.");
    return;
  }
  log(`Imprimiendo ticket de prueba en "${name}"…`);
  try {
    await agent.testPrint(name);
    log("Ticket de prueba enviado. ¿Salió por la impresora?");
  } catch (e) {
    log(`Error al imprimir la prueba: ${(e as Error).message}`);
  }
});

void refreshStatus();
void refreshPrinters();
```

- [ ] **Step 4: Verificar typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @suarex/agent-desktop build`
Expected: PASS (compila y bundlea main/preload/renderer). Sin ejecución.

- [ ] **Step 5: Commit**

```bash
git add apps/agent-desktop/src/main/index.ts apps/agent-desktop/src/preload/index.ts apps/agent-desktop/src/renderer
git commit -m "feat(agent-desktop): unattended lifecycle (tray, auto-launch, single-instance) + diagnostic UI"
```

---

## Task 7: Empaquetado NSIS + checklist de validación

**Files:**
- Create: `apps/agent-desktop/electron-builder.yml`
- Create: `apps/agent-desktop/build/` (icono placeholder si electron-builder lo exige)
- Create: `docs/agent-desktop-validacion.md`
- Modify: `apps/agent-desktop/package.json` (script `package` ya añadido en Task 1; ajustar si hace falta)

**Interfaces:**
- Produces: la config de electron-builder (NSIS x64, per-user, `asarUnpack` de koffi) y la **checklist de validación** que el usuario corre en Windows — el entregable que define "hecho".

**Verificación de esta tarea: la config es válida y `docs/agent-desktop-validacion.md` está completa.** NO se exige producir el `.exe` aquí: `electron-builder` para Windows NSIS puede requerir Windows o wine y no está garantizado en este entorno. El implementador PUEDE intentar `pnpm --filter @suarex/agent-desktop package` y, si falla por falta de wine/Windows, registrarlo en el report SIN considerarlo un fallo de la tarea (el empaquetado real lo valida el usuario).

- [ ] **Step 1: `apps/agent-desktop/electron-builder.yml`**

```yaml
appId: app.suarex.agent
productName: SuarEx Agente
directories:
  output: release
  buildResources: build
files:
  - out/**
# koffi trae un binario nativo (.node): debe salir del asar para poder cargarse en runtime.
asarUnpack:
  - "**/node_modules/koffi/**"
win:
  target:
    - target: nsis
      arch:
        - x64
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
```

- [ ] **Step 2: Escribir la checklist** — `docs/agent-desktop-validacion.md`:

```markdown
# Validación en hardware — App de escritorio del agente (C2b-b)

Esta app se construyó a ciegas (sin Windows ni impresora en el entorno de desarrollo).
Estos pasos, en el PC Windows 11 del cliente, son los que confirman que funciona. Si un
paso falla, captura lo que se indica y pégalo para diagnosticar.

## Requisitos
- Windows 11 x64, impresora ESC/POS USB con su driver instalado (aparece en "Impresoras y
  escáneres" con un nombre).
- El build de la app apuntando al Supabase correcto (dev durante pruebas).

## Pasos

1. **Instalar.** Ejecuta el instalador (`SuarEx Agente Setup *.exe`). Windows SmartScreen
   avisará (app sin firmar): pulsa **Más información → Ejecutar de todas formas**. Instala.
   - ✅ Esperado: se instala sin pedir admin y crea acceso directo.
   - ❌ Si falla: captura el mensaje del instalador.

2. **Arranque.** La app se abre y aparece en la bandeja del sistema.
   - ✅ Esperado: ventana "SuarEx — Agente de impresión", estado "sin emparejar".
   - ❌ Si el panel de log muestra "no se pudo cargar el binding de impresión": el `.node`
     de koffi no se empaquetó/cargó — captura el log completo.

3. **Impresoras.** Pulsa "Actualizar lista".
   - ✅ Esperado: aparece tu impresora ESC/POS por su nombre de Windows. Anota ese nombre
     EXACTO (lo necesitas en el panel cloud).
   - ❌ Si la lista está vacía: captura el log.

4. **Ticket de prueba (lo más importante).** Selecciona la impresora y pulsa "Imprimir
   ticket de prueba".
   - ✅ Esperado: sale un ticket "SUAREX / Ticket de prueba / <fecha>" por la impresora.
   - ❌ Si no sale nada o el log da error: captura el log (aquí es donde el binding
     winspool puede necesitar ajuste). Esto valida el camino RAW sin depender de la nube.

5. **Alta en el panel cloud.** En el panel de administración (web), crea una impresora de
   tipo **USB** con el nombre EXACTO del paso 3, atada a este dispositivo, con su destino
   (cocina/barra).

6. **Emparejar.** En el panel, genera un código de emparejamiento para este dispositivo.
   En la app, pégalo y pulsa "Emparejar".
   - ✅ Esperado: log "Emparejado: dispositivo …", estado pasa a "emparejado · agente
     corriendo".
   - ❌ "código inválido": el código caducó o se tecleó mal. "demasiados intentos": espera.

7. **Pedido real de punta a punta.** Haz un pedido QR de prueba y págalo.
   - ✅ Esperado: en pocos segundos, el ticket sale por la impresora, con la app minimizada
     en la bandeja.

8. **Desatendido.** Cierra la ventana (se oculta a bandeja), reinicia Windows.
   - ✅ Esperado: tras el login, la app arranca sola (bandeja) y sigue imprimiendo pedidos
     sin abrir la ventana.

## Qué capturar si algo falla
- El **panel de registro** completo de la app (cópialo entero).
- El nombre exacto de la impresora (paso 3).
- Si es el instalador: el mensaje de error de Windows.
```

- [ ] **Step 3: Intentar el empaquetado (best-effort) + verificar la config**

Run: `pnpm --filter @suarex/agent-desktop build && (pnpm --filter @suarex/agent-desktop package || echo "PACKAGE_REQUIERE_WINDOWS_O_WINE")`
Expected: el `build` (electron-vite) pasa; el `package` (electron-builder NSIS) **puede** fallar por falta de wine/Windows — en ese caso registra el mensaje en el report y NO lo trates como fallo de la tarea. Verifica a mano que `electron-builder.yml` es YAML válido y que `asarUnpack` cubre koffi.

- [ ] **Step 4: Commit**

```bash
git add apps/agent-desktop/electron-builder.yml apps/agent-desktop/build docs/agent-desktop-validacion.md
git commit -m "feat(agent-desktop): NSIS packaging config + hardware validation checklist"
```

---

## Verificación final de fase

- [ ] **Lo que SÍ se puede verificar aquí:**

Run:
```bash
pnpm typecheck && pnpm lint
pnpm test           # incluye los unit de agent-desktop (pairing, config-store, sink marshalling)
pnpm --filter @suarex/agent-desktop build
```
Expected: typecheck/lint limpios; unit en verde; `electron-vite build` compila. Registrar en el ledger.

- [ ] **Lo que NO se puede verificar aquí** queda para el usuario: la checklist `docs/agent-desktop-validacion.md` en el PC Windows. **C2b-b no está "hecha" hasta que esa checklist pase.**

- [ ] **Revisión de fase (opus)** vía superpowers:requesting-code-review sobre todo el diff de `feat/agente-c2b-b`, foco en: (1) que ningún secreto (service role) se hornee — solo URL + anon key; (2) que el FFI de winspool esté aislado y solo se cargue en win32 (el paquete typechequea y testea en macOS/Linux sin cargarlo); (3) que la contraseña se cifre siempre con safeStorage y nunca se escriba en claro; (4) que el renderer no tenga acceso directo a Node/Electron (contextIsolation + preload, todo por IPC); (5) que el sink real y el marshalling probado coincidan en contrato (write parcial = fallo); (6) que la checklist de validación sea completa y ejecutable.

---

## Self-Review del plan (hecho)

**1. Cobertura del spec:**
- App Electron + electron-vite que bundlea el workspace → Task 1. ✅
- Sink USB real (koffi+winspool RAW) aislado + marshalling testeable → Task 4. ✅
- Enumerar impresoras (Electron nativo) → Task 5. ✅
- Emparejamiento + credenciales cifradas (safeStorage) → Tasks 2/3/5. ✅
- Ciclo del agente (registra sink + runAgent) → Task 5. ✅
- Desatendido (auto-arranque, bandeja, single-instance, cerrar-a-bandeja) → Task 6. ✅
- UI diagnóstica (impresoras, botón test sin nube, log) → Task 6. ✅
- Empaquetado NSIS + config horneada → Tasks 1/7. ✅
- Checklist de validación → Task 7. ✅
- Cero migraciones — ninguna task añade SQL. ✅

**2. Placeholders:** el código de las partes testeables (pairing, config-store, sink marshalling) es completo y con TDD. El código de las partes ciegas (electron-vite config, FFI winspool real, Electron main/renderer, electron-builder) es completo pero explícitamente marcado como "primer borrador a validar en Windows" — no son placeholders (`TODO`), son código concreto cuyo gate honesto es typecheck/lint/build + la validación del usuario, no ejecución.

**3. Consistencia de tipos:** `PairResult`/`PairError` (Task 2) ↔ `ipc.pair`. `StoredCredentials`/`ConfigBackend` (Task 3) ↔ `realConfigBackend` (Task 5) ↔ `agent-runner`. `WinspoolBinding`/`makeUsbSink` (Task 4) ↔ `printers.ts`/`agent-runner.ts` (Task 5). `UsbRawSink`/`registerUsbRawSink`/`renderEscPos`/`runAgent`/`AgentCredentials` de `@suarex/*` usados con su firma real. Los canales IPC del preload (Task 6) ↔ los `ipcMain.handle` (Task 5).

**Riesgos anotados:** (a) el punto más incierto es que electron-vite bundlee los `@suarex/*` (TS crudo con imports `.js`) — Task 1 lo provoca temprano; si falla, ajustar el config y registrarlo. (b) El FFI de winspool (firmas koffi exactas, structs, out-params) es la otra incógnita — aislado en un fichero, con marshalling testeado y la llamada real validada por el botón de test en Windows. (c) `electron-builder` puede no producir el `.exe` en este entorno (wine/Windows) — best-effort, la validación real es del usuario. Ninguna task afirma "impreso" ni "instalado" como verificado aquí: eso vive en la checklist.
