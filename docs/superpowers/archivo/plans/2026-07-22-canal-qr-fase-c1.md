# Canal QR — Fase C1: la lógica de impresión, verificable en local

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un pedido pagado se convierte en los bytes ESC/POS correctos y se entrega a una impresora de red, enrutado a cocina o barra, sin duplicar ante un reintento y sin perderse ante una caída de red — todo demostrado contra un servidor de impresora falso y la base de datos local, sin hardware ni Electron.

**Architecture:** Toda la lógica vive en paquetes puros y testables. `@suarex/ticket` construye un `TicketLine[]` abstracto desde un pedido y la marca del tenant. `@suarex/printing` renderiza esas líneas a bytes ESC/POS, las entrega por un adaptador de red, y serializa los trabajos por dispositivo. La reserva de impresión y la idempotencia por impresora viven en `@suarex/db` contra las columnas `printed_at` / `printed_targets` que ya existen. La cáscara Electron, el camino Windows RAW y el empaquetado son la fase C2 y no se tocan aquí.

**Tech Stack:** TypeScript strict, `node-thermal-printer` para los bytes ESC/POS, `node:net` para el adaptador y el servidor falso, Vitest, Supabase (stack local). Base de referencia copiada de GARUM (`packages/shared/src/ticket/build.ts`, `order-routing.ts`, `apps/desktop/src/main/printer/`), reescrita multitenant.

## Global Constraints

- Directorio único: `/Users/ivangonzalez/Documents/proyectos/suarex-platform`. **Prohibido escribir en** `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2`, `web-prueba`. Se puede LEER GARUM como referencia; no se copia por symlink ni workspace, se transcribe y adapta.
- Prohibido conectar o aplicar migraciones a los proyectos Supabase de producción. Solo el stack local. Nunca `supabase link`.
- Ninguna policy RLS puede ser `USING (true)`. Las formas permitidas viven en `tests/integration/helpers/policy-check.ts`, coincidencia exacta; una forma nueva se añade textual, nunca se relaja la comparación.
- Toda tabla de dominio lleva `tenant_id uuid not null` con índice.
- El header del ticket, los datos fiscales y la moneda salen de `tenant_settings` — **nunca** un literal como el `"GARUM VINOTECA"` incrustado en el builder de GARUM. Rebrandear es una fila, no un cambio de código.
- Money en céntimos enteros; formatear solo en el borde.
- Un dispositivo se autentica como cuenta de servicio con rol `device` en `memberships`, lleva su `tenant_id` en el claim del JWT igual que el personal, y RLS lo acota. El emparejamiento lo orquesta el servidor con service role; el dispositivo nunca se da de alta a sí mismo.
- Un pedido pagado no se pierde: la idempotencia es por impresora en `printed_targets`, y la recuperación relee el conjunto autoritativo, no confía solo en el evento de Realtime.
- TypeScript strict. Prohibido `any` explícito, `@ts-ignore`, `@ts-expect-error`.
- Ningún test se salta en una ejecución por defecto.
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:tests`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` en verde al terminar cada tarea. Preservar las tres variables de Stripe en `apps/web/.env.local` si se regenera. Tras `supabase db reset`, el orden es `pnpm db:env` → `pnpm seed:staff` (registrado como gotcha en la fase B).
- Conventional Commits.

---

## Estructura de ficheros

```
packages/
  ticket/                          @suarex/ticket — NUEVO, puro
    src/sanitize.ts                acentos → ASCII para térmica
    src/routing.ts                 cocina/barra con fallback por palabra
    src/build.ts                   pedido + marca → TicketLine[]
    src/types.ts                   TicketLine, TicketDestination
    src/index.ts
  printing/                        @suarex/printing — NUEVO
    src/render.ts                  TicketLine[] → bytes ESC/POS
    src/adapters/escpos-tcp.ts     entrega por red, puerto 9100
    src/adapters/types.ts          PrinterAdapter, PrinterConfig, PrintResult
    src/queue.ts                   serialización por dispositivo
    src/print-order.ts            orquesta: construir → renderar → enrutar → entregar
    src/index.ts
  db/
    src/print-jobs.ts              NUEVO: reservePrintAndDispatch, unprintedOrders
    src/devices.ts                 NUEVO: pairDevice, lookup
    src/index.ts                   MODIFICAR
apps/web/
  app/api/devices/pair/route.ts    NUEVO: canjea código de emparejamiento
  app/staff/devices/…              (fuera de C1 — el CRUD de dispositivos es C2/admin)
supabase/migrations/
  20260722000001_devices_printers.sql
tests/
  helpers/fake-escpos-server.ts    NUEVO: socket TCP que captura bytes
  integration/print-jobs.test.ts
  integration/device-pairing.test.ts
  unit en cada paquete
```

---

### Task 1: `@suarex/ticket` — construir el ticket desde la marca del tenant

**Files:**
- Create: `packages/ticket/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `packages/ticket/src/{types.ts,sanitize.ts,routing.ts,build.ts,index.ts}`
- Test: `packages/ticket/src/{sanitize.test.ts,routing.test.ts,build.test.ts}`

**Interfaces:**
- Consumes: nada. Paquete puro.
- Produces:
  - `type TicketLine = { kind: "text"; text: string; align: "left"|"center"|"right"; bold?: boolean; size?: 1|2 } | { kind: "divider" } | { kind: "newline" } | { kind: "cut" }`
  - `type TicketDestination = "cocina" | "barra" | "all"`
  - `type TicketItem = { name: string; quantity: number; destination: "cocina"|"barra"|null; extras: string[] }`
  - `type TicketOrder = { orderNumber: number; tableLabel: string|null; createdAt: string; items: TicketItem[] }`
  - `type TicketBranding = { header: string }` — el nombre del negocio, de `tenant_settings`
  - `sanitizeForThermal(text: string): string`
  - `effectiveDestination(item: TicketItem): "cocina"|"barra"`
  - `buildTicketLines(order: TicketOrder, branding: TicketBranding, destination: TicketDestination): TicketLine[]`

- [ ] **Step 1: Crear el paquete**

`packages/ticket/package.json`:
```json
{
  "name": "@suarex/ticket",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.9.3", "vitest": "^4.1.5" }
}
```

`packages/ticket/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }
```

`packages/ticket/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: {} });
```

- [ ] **Step 2: Escribir los tests que fallan**

`packages/ticket/src/sanitize.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { sanitizeForThermal } from "./sanitize.js";

describe("sanitizeForThermal", () => {
  it("quita los acentos", () => {
    expect(sanitizeForThermal("Jamón")).toBe("Jamon");
    expect(sanitizeForThermal("café con leche")).toBe("cafe con leche");
  });
  it("conserva la eñe como n", () => {
    expect(sanitizeForThermal("Niño")).toBe("Nino");
  });
  it("pliega comillas tipográficas y guiones a ASCII", () => {
    expect(sanitizeForThermal("“hola”—ya")).toBe('"hola"-ya');
  });
  it("reemplaza un emoji por interrogante", () => {
    expect(sanitizeForThermal("pizza 🍕")).toBe("pizza ?");
  });
  it("deja el euro intacto (codepage 858 lo tiene)", () => {
    expect(sanitizeForThermal("3,50 €")).toBe("3,50 €");
  });
});
```

`packages/ticket/src/routing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { effectiveDestination } from "./routing.js";

describe("effectiveDestination", () => {
  it("respeta el destino explícito", () => {
    expect(effectiveDestination({ name: "Vino", quantity: 1, destination: "cocina", extras: [] })).toBe("cocina");
  });
  it("infiere barra por palabra clave cuando no hay destino", () => {
    expect(effectiveDestination({ name: "Copa de vino", quantity: 1, destination: null, extras: [] })).toBe("barra");
    expect(effectiveDestination({ name: "Caña", quantity: 1, destination: null, extras: [] })).toBe("barra");
  });
  it("cae en cocina por defecto", () => {
    expect(effectiveDestination({ name: "Tosta de jamón", quantity: 1, destination: null, extras: [] })).toBe("cocina");
  });
  it("ignora acentos al inferir", () => {
    expect(effectiveDestination({ name: "Café", quantity: 1, destination: null, extras: [] })).toBe("barra");
  });
});
```

`packages/ticket/src/build.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildTicketLines } from "./build.js";
import type { TicketOrder } from "./types.js";

const order: TicketOrder = {
  orderNumber: 42,
  tableLabel: "5",
  createdAt: "2026-07-22T10:30:00.000Z",
  items: [
    { name: "Tosta de jamón", quantity: 2, destination: "cocina", extras: [] },
    { name: "Copa de vino", quantity: 1, destination: "barra", extras: [] },
  ],
};
const branding = { header: "Bar Ejemplo" };

describe("buildTicketLines", () => {
  it("usa el header del tenant, no un literal", () => {
    const lines = buildTicketLines(order, branding, "cocina");
    const header = lines.find((l) => l.kind === "text" && l.bold && l.size === 2);
    expect(header && header.kind === "text" && header.text).toBe("Bar Ejemplo");
  });

  it("el ticket de cocina solo lleva los ítems de cocina", () => {
    const lines = buildTicketLines(order, branding, "cocina");
    const texts = lines.filter((l) => l.kind === "text").map((l) => (l.kind === "text" ? l.text : ""));
    expect(texts.some((t) => t.includes("Tosta de jamon"))).toBe(true);
    expect(texts.some((t) => t.includes("Copa de vino"))).toBe(false);
  });

  it("el ticket de barra solo lleva los ítems de barra", () => {
    const lines = buildTicketLines(order, branding, "barra");
    const texts = lines.filter((l) => l.kind === "text").map((l) => (l.kind === "text" ? l.text : ""));
    expect(texts.some((t) => t.includes("Copa de vino"))).toBe(true);
    expect(texts.some((t) => t.includes("Tosta"))).toBe(false);
  });

  it("termina en corte", () => {
    const lines = buildTicketLines(order, branding, "cocina");
    expect(lines.at(-1)?.kind).toBe("cut");
  });

  it("un destino sin ítems no revienta: header, aviso y corte", () => {
    const soloBarra: TicketOrder = { ...order, items: [order.items[1]] };
    const lines = buildTicketLines(soloBarra, branding, "cocina");
    expect(lines.at(-1)?.kind).toBe("cut");
    const texts = lines.filter((l) => l.kind === "text").map((l) => (l.kind === "text" ? l.text : ""));
    expect(texts.some((t) => /sin .*tems/i.test(t))).toBe(true);
  });

  it("sanea el nombre del ítem en la línea", () => {
    const lines = buildTicketLines(order, branding, "cocina");
    const texts = lines.filter((l) => l.kind === "text").map((l) => (l.kind === "text" ? l.text : ""));
    expect(texts.some((t) => t.includes("Tosta de jamon"))).toBe(true);
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que fallan**

Run: `pnpm --filter @suarex/ticket test`
Expected: FAIL — módulos no resueltos.

- [ ] **Step 4: Implementar**

`packages/ticket/src/types.ts`:
```ts
export type TicketDestination = "cocina" | "barra" | "all";

export type TicketLine =
  | { kind: "text"; text: string; align: "left" | "center" | "right"; bold?: boolean; size?: 1 | 2 }
  | { kind: "divider" }
  | { kind: "newline" }
  | { kind: "cut" };

export type TicketItem = {
  name: string;
  quantity: number;
  destination: "cocina" | "barra" | null;
  extras: string[];
};

export type TicketOrder = {
  orderNumber: number;
  tableLabel: string | null;
  createdAt: string;
  items: TicketItem[];
};

export type TicketBranding = { header: string };
```

`packages/ticket/src/sanitize.ts` — transcrito de `GARUM/packages/shared/src/ticket/build.ts:11-24`, sin cambios de comportamiento:
```ts
/**
 * Prepara texto para una impresora térmica en codepage 858. Quita diacríticos
 * (é→e, ñ→n), pliega comillas y guiones tipográficos a ASCII, y sustituye por
 * "?" cualquier carácter fuera de \x20-\xff (emoji incluidos). El euro se
 * conserva porque 858 lo incluye.
 */
export function sanitizeForThermal(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // marcas diacríticas combinantes
    .replace(/[‘’]/g, "'") // comillas simples tipográficas
    .replace(/[“”]/g, '"') // comillas dobles tipográficas
    .replace(/[–—]/g, "-") // guiones en/em
    .replace(/…/g, "...") // puntos suspensivos
    .replace(/[\u{1f000}-\u{1ffff}]/gu, "?") // emoji
    .replace(/[^\x20-\xff€]/g, "?"); // fuera de latin1, salvo el euro
}
```

**Al transcribir, usa los rangos Unicode ESCAPADOS, no los caracteres literales** — un rango literal en el fichero es frágil. Toma la forma exacta de `GARUM/packages/shared/src/ticket/build.ts:11-24`, que ya usa `̀-ͯ` para los diacríticos, y verifica con el test `sanitize.test.ts` que `"Jamón" → "Jamon"` y `"3,50 €" → "3,50 €"`. El comportamiento debe ser idéntico al de GARUM.
```

`packages/ticket/src/routing.ts` — transcrito de `GARUM/packages/shared/src/order-routing.ts`:
```ts
import type { TicketItem } from "./types.js";

const BARRA_KEYWORDS = [
  "vino", "cerveza", "cana", "cafe", "copa", "coctel", "agua", "refresco",
  "infusion", "champan", "cava", "licor", "whisky", "whiskey", "gintonic",
  "gin", "ron", "vermut", "vermouth",
];

function normalize(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * El destino explícito manda. Sin él, se infiere: barra solo si el nombre
 * contiene una palabra de bebida; en caso contrario, cocina. El fallback existe
 * para pedidos sin destino asignado.
 */
export function effectiveDestination(item: TicketItem): "cocina" | "barra" {
  if (item.destination === "cocina" || item.destination === "barra") return item.destination;
  const n = normalize(item.name);
  return BARRA_KEYWORDS.some((kw) => n.includes(kw)) ? "barra" : "cocina";
}

export function filterItems(items: TicketItem[], destination: "cocina" | "barra"): TicketItem[] {
  return items.filter((item) => effectiveDestination(item) === destination);
}
```

`packages/ticket/src/build.ts` — estructura de `GARUM/packages/shared/src/ticket/build.ts:38-74`, con el header parametrizado:
```ts
import { filterItems } from "./routing.js";
import { sanitizeForThermal } from "./sanitize.js";
import type { TicketBranding, TicketDestination, TicketLine, TicketOrder } from "./types.js";

const DEST_LABELS: Record<TicketDestination, string> = { cocina: "COCINA", barra: "BARRA", all: "TODOS" };

function formatHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid",
  });
}

export function buildTicketLines(
  order: TicketOrder,
  branding: TicketBranding,
  destination: TicketDestination,
): TicketLine[] {
  const items =
    destination === "all" ? order.items : filterItems(order.items, destination);

  const lines: TicketLine[] = [
    { kind: "text", text: sanitizeForThermal(branding.header), align: "center", bold: true, size: 2 },
    { kind: "divider" },
    { kind: "text", text: DEST_LABELS[destination], align: "center", bold: true, size: 2 },
    order.tableLabel
      ? { kind: "text", text: `MESA ${order.tableLabel}`, align: "left", bold: true }
      : { kind: "text", text: "PARA LLEVAR", align: "left", bold: true },
    { kind: "text", text: `Hora: ${formatHHMM(order.createdAt)}`, align: "left" },
    { kind: "divider" },
  ];

  if (items.length === 0) {
    lines.push({ kind: "text", text: `Sin items para ${DEST_LABELS[destination]}`, align: "center" });
  } else {
    for (const item of items) {
      lines.push({
        kind: "text",
        text: `${item.quantity}x  ${sanitizeForThermal(item.name)}`,
        align: "left",
      });
      for (const extra of item.extras) {
        lines.push({ kind: "text", text: `   + ${sanitizeForThermal(extra)}`, align: "left" });
      }
    }
  }

  lines.push(
    { kind: "divider" },
    { kind: "text", text: `Pedido #${order.orderNumber}`, align: "center" },
    { kind: "newline" },
    { kind: "cut" },
  );

  return lines;
}
```

`packages/ticket/src/index.ts`:
```ts
export { buildTicketLines } from "./build.js";
export { effectiveDestination, filterItems } from "./routing.js";
export { sanitizeForThermal } from "./sanitize.js";
export type { TicketBranding, TicketDestination, TicketItem, TicketLine, TicketOrder } from "./types.js";
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

Run: `pnpm install && pnpm --filter @suarex/ticket test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ticket pnpm-lock.yaml
git commit -m "feat(ticket): tenant-branded ESC/POS ticket lines"
```

---

### Task 2: `@suarex/printing` — renderizar, entregar por red, serializar

**Files:**
- Create: `packages/printing/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `packages/printing/src/{render.ts,queue.ts,print-order.ts,index.ts}`, `packages/printing/src/adapters/{types.ts,escpos-tcp.ts}`
- Create: `tests/helpers/fake-escpos-server.ts`
- Test: `packages/printing/src/{render.test.ts,queue.test.ts}`, `packages/printing/src/adapters/escpos-tcp.test.ts`

**Interfaces:**
- Consumes: `TicketLine`, `buildTicketLines` (Task 1).
- Produces:
  - `type PrinterConfig = { id: string; label: string; destination: "cocina"|"barra"|"all"; adapter: "escpos-tcp"; host: string; port: number }`
  - `type PrintResult = { id: string; label: string; ok: boolean; reason?: string }`
  - `renderEscPos(lines: TicketLine[]): Buffer`
  - `enqueueByDevice(deviceKey: string, task: () => Promise<T>): Promise<T>`
  - `deviceKey(config: PrinterConfig): string`
  - `printToPrinter(lines: TicketLine[], config: PrinterConfig): Promise<PrintResult>`

- [ ] **Step 1: Crear el paquete y permitir el import**

`packages/printing/package.json`:
```json
{
  "name": "@suarex/printing",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@suarex/ticket": "workspace:*", "node-thermal-printer": "^4.6.0" },
  "devDependencies": { "@types/node": "^25.6.0", "typescript": "^5.9.3", "vitest": "^4.1.5" }
}
```

`tsconfig.json` y `vitest.config.ts` como en la Task 1.

- [ ] **Step 2: El servidor ESC/POS falso**

Ésta es la pieza que hace verificable toda la fase sin hardware. Abre un socket TCP en el puerto 9100 (o uno efímero), acepta la conexión del adaptador, y acumula los bytes recibidos para poder afirmar sobre ellos.

`tests/helpers/fake-escpos-server.ts`:
```ts
import net from "node:net";

export type FakedPrinter = {
  port: number;
  received: () => Buffer;
  connectionCount: () => number;
  failNextConnection: () => void;
  close: () => Promise<void>;
};

/**
 * Impresora ESC/POS de mentira: un socket TCP que acepta la conexión del
 * adaptador y guarda todo lo que recibe. Permite afirmar QUÉ bytes se
 * imprimieron, CUÁNTAS veces se conectó el adaptador (para detectar duplicados),
 * y simular un fallo de conexión (para probar reintentos y recuperación).
 */
export function startFakePrinter(): Promise<FakedPrinter> {
  const chunks: Buffer[] = [];
  let connections = 0;
  let failOnce = false;

  const server = net.createServer((socket) => {
    connections += 1;
    if (failOnce) {
      failOnce = false;
      socket.destroy();
      return;
    }
    socket.on("data", (d) => chunks.push(d));
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        reject(new Error("No se pudo obtener el puerto"));
        return;
      }
      resolve({
        port: address.port,
        received: () => Buffer.concat(chunks),
        connectionCount: () => connections,
        failNextConnection: () => { failOnce = true; },
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
```

- [ ] **Step 3: Escribir los tests que fallan**

`packages/printing/src/render.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { renderEscPos } from "./render.js";

describe("renderEscPos", () => {
  it("produce bytes no vacíos y termina en el comando de corte", () => {
    const buf = renderEscPos([
      { kind: "text", text: "Hola", align: "center", bold: true },
      { kind: "cut" },
    ]);
    expect(buf.length).toBeGreaterThan(0);
    // GS V — comando de corte de ESC/POS.
    expect(buf.includes(Buffer.from([0x1d, 0x56]))).toBe(true);
  });

  it("incluye el texto de las líneas", () => {
    const buf = renderEscPos([{ kind: "text", text: "PEDIDO", align: "left" }, { kind: "cut" }]);
    expect(buf.includes(Buffer.from("PEDIDO", "latin1"))).toBe(true);
  });
});
```

`packages/printing/src/adapters/escpos-tcp.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { startFakePrinter, type FakedPrinter } from "../../../../tests/helpers/fake-escpos-server.js";
import { printToPrinter } from "../print-order.js";
import type { PrinterConfig } from "./types.js";

let printer: FakedPrinter;
afterEach(async () => { await printer?.close(); });

const lines = [
  { kind: "text" as const, text: "COCINA", align: "center" as const, bold: true },
  { kind: "text" as const, text: "1x  Tosta", align: "left" as const },
  { kind: "cut" as const },
];

describe("printToPrinter (escpos-tcp)", () => {
  it("entrega los bytes a la impresora", async () => {
    printer = await startFakePrinter();
    const config: PrinterConfig = {
      id: "p1", label: "Cocina", destination: "cocina",
      adapter: "escpos-tcp", host: "127.0.0.1", port: printer.port,
    };

    const result = await printToPrinter(lines, config);

    expect(result.ok).toBe(true);
    expect(printer.received().includes(Buffer.from("COCINA", "latin1"))).toBe(true);
    expect(printer.received().includes(Buffer.from("Tosta", "latin1"))).toBe(true);
  });

  it("devuelve ok:false si la impresora no está", async () => {
    printer = await startFakePrinter();
    const port = printer.port;
    await printer.close();

    const config: PrinterConfig = {
      id: "p1", label: "Cocina", destination: "cocina",
      adapter: "escpos-tcp", host: "127.0.0.1", port,
    };

    const result = await printToPrinter(lines, config);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
```

`packages/printing/src/queue.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { enqueueByDevice } from "./queue.js";

describe("enqueueByDevice", () => {
  it("serializa las tareas del mismo dispositivo, en orden", async () => {
    const order: number[] = [];
    const slow = (n: number, ms: number) =>
      enqueueByDevice("dev-a", async () => {
        await new Promise((r) => setTimeout(r, ms));
        order.push(n);
      });

    await Promise.all([slow(1, 30), slow(2, 5), slow(3, 1)]);
    // Mismo dispositivo: se ejecutan en el orden de encolado pese a los tiempos.
    expect(order).toEqual([1, 2, 3]);
  });

  it("una tarea que falla no bloquea la siguiente del mismo dispositivo", async () => {
    await enqueueByDevice("dev-b", async () => { throw new Error("boom"); }).catch(() => {});
    const ok = await enqueueByDevice("dev-b", async () => "ok");
    expect(ok).toBe("ok");
  });

  it("dispositivos distintos no se serializan entre sí", async () => {
    const start = Date.now();
    await Promise.all([
      enqueueByDevice("x", () => new Promise((r) => setTimeout(r, 40))),
      enqueueByDevice("y", () => new Promise((r) => setTimeout(r, 40))),
    ]);
    // En paralelo tarda ~40ms, no ~80ms.
    expect(Date.now() - start).toBeLessThan(75);
  });
});
```

- [ ] **Step 4: Ejecutar y verificar que fallan**

Run: `pnpm --filter @suarex/printing test`
Expected: FAIL.

- [ ] **Step 5: Implementar**

`packages/printing/src/adapters/types.ts`:
```ts
export type PrinterConfig = {
  id: string;
  label: string;
  destination: "cocina" | "barra" | "all";
  adapter: "escpos-tcp";
  host: string;
  port: number;
};

export type PrintResult = { id: string; label: string; ok: boolean; reason?: string };
```

`packages/printing/src/render.ts` — usa `node-thermal-printer` en modo buffer (como `buildEscPosBuffer` de GARUM, `ticket.ts:228-242`), con una interfaz `tcp://127.0.0.1:9100` que nunca se abre:
```ts
import { CharacterSet, PrinterTypes, ThermalPrinter } from "node-thermal-printer";
import type { TicketLine } from "@suarex/ticket";

/**
 * Renderiza las líneas a bytes ESC/POS SIN abrir ninguna conexión: se construye
 * un ThermalPrinter con una interfaz ficticia y se pide `getBuffer()`. La entrega
 * la hace el adaptador. Charset PC858_EURO para conservar el símbolo del euro.
 */
export function renderEscPos(lines: TicketLine[]): Buffer {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: "tcp://127.0.0.1:9100",
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
  });

  for (const line of lines) {
    if (line.kind === "text") {
      printer.alignCenter();
      if (line.align === "left") printer.alignLeft();
      if (line.align === "right") printer.alignRight();
      printer.bold(Boolean(line.bold));
      printer.setTextSize(line.size === 2 ? 1 : 0, line.size === 2 ? 1 : 0);
      printer.println(line.text);
      printer.setTextSize(0, 0);
      printer.bold(false);
    } else if (line.kind === "divider") {
      printer.drawLine();
    } else if (line.kind === "newline") {
      printer.newLine();
    } else if (line.kind === "cut") {
      printer.cut();
    }
  }

  return printer.getBuffer();
}
```

`packages/printing/src/queue.ts` — transcrito de `GARUM/apps/desktop/src/main/printer/index.ts:24-50`:
```ts
const queues = new Map<string, Promise<unknown>>();

/**
 * Serializa las tareas dirigidas al mismo dispositivo físico. Dos configs que
 * apuntan a la misma impresora comparten cola (dos WritePrinter simultáneos a la
 * misma cola de impresión pierden un ticket en silencio); impresoras distintas
 * corren en paralelo. La tarea se ejecuta aunque la anterior haya fallado.
 */
export function enqueueByDevice<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  queues.set(key, next.catch(() => {}));
  return next;
}
```

`packages/printing/src/print-order.ts`:
```ts
import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import type { TicketLine } from "@suarex/ticket";
import type { PrinterConfig, PrintResult } from "./adapters/types.js";
import { renderEscPos } from "./render.js";

const MAX_TRIES = 3;
const RETRY_MS = 2000;

export function deviceKey(config: PrinterConfig): string {
  return `tcp::${config.host}:${config.port}`;
}

/**
 * Entrega las líneas a una impresora de red. Un ThermalPrinter FRESCO por intento
 * (un buffer contaminado tras un fallo reimprime basura), hasta MAX_TRIES con
 * back-off. No pre-sondea el socket: el puerto 9100 acepta una conexión a la vez,
 * y un ping compite con el `execute` real. Patrón de GARUM `ticket.ts:356-401`.
 */
export async function printToPrinter(lines: TicketLine[], config: PrinterConfig): Promise<PrintResult> {
  const buffer = renderEscPos(lines);
  let lastReason = "";

  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: `tcp://${config.host}:${config.port}`,
        characterSet: CharacterSet.PC858_EURO,
        removeSpecialCharacters: false,
        options: { timeout: 5000 },
      });
      printer.raw(buffer);
      await printer.execute();
      return { id: config.id, label: config.label, ok: true };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_TRIES) await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }

  return { id: config.id, label: config.label, ok: false, reason: lastReason };
}
```

`packages/printing/src/index.ts`:
```ts
export type { PrinterConfig, PrintResult } from "./adapters/types.js";
export { deviceKey, printToPrinter } from "./print-order.js";
export { enqueueByDevice } from "./queue.js";
export { renderEscPos } from "./render.js";
```

- [ ] **Step 6: Ejecutar y verificar que pasan**

Run: `pnpm install && pnpm --filter @suarex/printing test`
Expected: PASS

- [ ] **Step 7: Permitir el import de node-thermal-printer si el lint lo restringe**

Si `biome.json` tiene una regla de imports que afecte a este paquete, comprueba `pnpm lint`. `node-thermal-printer` no es `@supabase/supabase-js`, así que no debería aplicar la restricción existente. Si aparece cualquier otra regla, resuélvela sin desactivarla globalmente.

- [ ] **Step 8: Commit**

```bash
git add packages/printing tests/helpers/fake-escpos-server.ts pnpm-lock.yaml
git commit -m "feat(printing): escpos-tcp adapter, render and per-device queue with a fake printer harness"
```

---

### Task 3: Tablas `devices` y `printers`, y emparejamiento por código

**Files:**
- Create: `supabase/migrations/20260722000001_devices_printers.sql`
- Create: `packages/db/src/devices.ts`; Modify: `packages/db/src/index.ts`
- Create: `apps/web/app/api/devices/pair/route.ts`
- Modify: `tests/integration/helpers/policy-check.ts` (si hiciera falta una forma nueva, exacta), `tests/integration/tenant-isolation.test.ts` (`WRITE_FIXTURES`)
- Test: `tests/integration/device-pairing.test.ts`

**Interfaces:**
- Consumes: `public.tenants`, `public.venues`, `public.memberships`, `public.current_tenant_id()`.
- Produces:
  - tablas `public.devices`, `public.printers`
  - `pairDevice(pairingCode: string): Promise<{ deviceId: string; email: string; password: string; tenantId: string } | null>` — canjea el código, crea la cuenta de servicio, devuelve credenciales una sola vez
  - `POST /api/devices/pair` — body `{ pairingCode }`, responde las credenciales o 404

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/20260722000001_devices_printers.sql`:
```sql
-- Un dispositivo es una cuenta de servicio no humana del tenant: imprime y
-- reporta estado, nada más. Se le da de alta desde el panel (service role),
-- obtiene un código de emparejamiento corto y caducable, y la app lo canjea en
-- su primera ejecución por credenciales propias. Ni la URL ni la anon key ni
-- ningún secreto viajan en el instalador -- ése es el fallo que arrastra el
-- agente actual, con la anon key escrita en su código fuente.

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  name text not null,
  roles text[] not null default '{agente}',
  auth_user_id uuid references auth.users (id) on delete set null,
  pairing_code text,
  pairing_expires_at timestamptz,
  paired_at timestamptz,
  app_version text,
  last_seen_at timestamptz,
  os text,
  created_at timestamptz not null default now()
);
create index devices_tenant_id_idx on public.devices (tenant_id);
create unique index devices_pairing_code_idx on public.devices (pairing_code) where pairing_code is not null;

create table public.printers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  name text not null,
  connection jsonb not null,
  destination text not null default 'cocina' check (destination in ('cocina', 'barra', 'all')),
  is_default boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index printers_tenant_id_idx on public.printers (tenant_id);

-- Consistencia de tenant en las FK a venue/device, como el resto del esquema.
create trigger devices_same_tenant before insert or update on public.devices
  for each row execute function public.assert_same_tenant();
create trigger printers_same_tenant before insert or update on public.printers
  for each row execute function public.assert_same_tenant();

alter table public.devices enable row level security;
alter table public.printers enable row level security;

create policy devices_isolation on public.devices
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy printers_isolation on public.printers
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

revoke all on public.devices, public.printers from anon;

-- El rol 'device' se añade al CHECK de memberships para que la cuenta de
-- servicio del dispositivo tenga su tenant_id inyectado por el mismo hook que
-- el personal. Se recrea el CHECK con el valor nuevo.
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check
  check (role in ('owner', 'admin', 'staff', 'device'));
```

Nota para quien implemente: extiende `assert_same_tenant()` con las ramas de `devices` (contra `venues`) y `printers` (contra `venues` y, si `device_id` no es null, contra `devices`), siguiendo el patrón de las tablas anteriores y conservando el `else raise`. No pegues la versión de una tarea vieja encima: mergea sobre la función actual, que ya tiene ramas para `tables`, `order_counters`, `orders`, `order_items`, `order_item_extras`.

- [ ] **Step 2: Declarar cobertura anti-fuga y aplicar**

Run: `supabase db reset && pnpm db:env && pnpm seed:staff && pnpm test:integration`
Expected: FAIL nombrando `devices` y `printers` por no estar en `WRITE_FIXTURES`. Añade sus entradas siguiendo la forma real del fichero, con el `expectedInsertRejection` correcto (P0001 por el trigger, como las otras tablas con `assert_same_tenant`). Vuelve a ejecutar hasta verde.

- [ ] **Step 3: El emparejamiento — test primero**

`tests/integration/device-pairing.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { pairDevice } from "@suarex/db";
import { admin, createTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

let tenant: TenantFixture;
let venueId: string;

beforeAll(async () => {
  tenant = await createTenantFixture(`dev-${nonce()}`);
  const { data: venue } = await admin
    .from("venues").insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id").single();
  venueId = venue?.id as string;
});

async function newDeviceWithCode(code: string, expiresInMs: number): Promise<string> {
  const { data } = await admin
    .from("devices")
    .insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "Agente cocina",
      pairing_code: code, pairing_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    })
    .select("id").single();
  return data?.id as string;
}

describe("pairDevice", () => {
  it("canjea un código válido y devuelve credenciales que resuelven el tenant", async () => {
    const code = `PAIR-${nonce()}`;
    await newDeviceWithCode(code, 60_000);

    const result = await pairDevice(code);
    expect(result).not.toBeNull();
    expect(result?.tenantId).toBe(tenant.tenantId);

    // Las credenciales sirven, y el claim del JWT lleva el tenant correcto.
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_ANON_KEY as string, {
      auth: { persistSession: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email: result?.email as string, password: result?.password as string,
    });
    expect(error).toBeNull();
    const { data } = await client.auth.getClaims();
    expect(data?.claims?.tenant_id).toBe(tenant.tenantId);
  });

  it("un código caducado no empareja", async () => {
    const code = `EXP-${nonce()}`;
    await newDeviceWithCode(code, -1000);
    expect(await pairDevice(code)).toBeNull();
  });

  it("un código inexistente devuelve null, sin revelar nada", async () => {
    expect(await pairDevice(`NOPE-${nonce()}`)).toBeNull();
  });

  it("el código es de un solo uso: tras canjear, no vuelve a servir", async () => {
    const code = `ONCE-${nonce()}`;
    await newDeviceWithCode(code, 60_000);
    expect(await pairDevice(code)).not.toBeNull();
    expect(await pairDevice(code)).toBeNull();
  });
});
```

Nota para quien implemente: `tests/integration/helpers/tenants.ts` importa `@supabase/supabase-js` bajo la excepción de biome; este test también lo necesita, así que vive bien en `tests/integration/`.

- [ ] **Step 4: Implementar `pairDevice`**

Vive en `packages/db` porque usa el service role. Debe, en este orden:

1. Buscar el dispositivo por `pairing_code` con `pairing_expires_at > now()`. Si no hay, devolver `null`.
2. Crear una cuenta de Supabase Auth (email `device-{id}@devices.local`, contraseña `crypto.randomUUID()`).
3. **Crear una fila en `memberships`** con `user_id` = esa cuenta, `tenant_id` del dispositivo, `role = 'device'`. Ésta es la vía decidida: el hook `custom_access_token_hook` ya inyecta el `tenant_id` desde `memberships`, así que el dispositivo obtiene su claim por el mismo mecanismo probado que el personal, sin tocar el hook. (No se usa `app_metadata`.)
4. Enlazar `auth_user_id` en `devices` y poner `paired_at`.
5. **Borrar el `pairing_code`** (ponerlo a `null`) para que sea de un solo uso.
6. Devolver las credenciales una sola vez. No se vuelven a poder recuperar; la app las guarda en su directorio de datos.

El paso 3 lo hace el service role, no el dispositivo: la fase B revocó la escritura de `memberships` a `authenticated`, y eso no se toca.

Usa el accesor estrecho existente o añade uno acotado por firma a `devices`, con el mismo patrón documentado que los demás. No un escape hatch genérico.

`POST /api/devices/pair` en `apps/web`: valida el body, llama a `pairDevice`, responde las credenciales o 404. Un código malformado o inexistente devuelve el **mismo** 404, sin revelar si existe.

- [ ] **Step 5: Verificar y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`

```bash
git add supabase/migrations/20260722000001_devices_printers.sql packages/db apps/web tests/integration/device-pairing.test.ts tests/integration/tenant-isolation.test.ts
git commit -m "feat(db): device pairing with service-account credentials"
```

---

### Task 4: Reserva de impresión e idempotencia por impresora

El corazón de "un pedido cobrado no se pierde". Vive en `@suarex/db` y se prueba contra la base local: el paquete `@suarex/printing` entrega bytes; esta tarea decide **qué** imprimir y registra qué se imprimió, de forma que un reintento nunca duplique y una caída de red no pierda nada.

**Files:**
- Create: `packages/db/src/print-jobs.ts`; Modify: `packages/db/src/index.ts`
- Test: `tests/integration/print-jobs.test.ts`

**Interfaces:**
- Consumes: `public.orders` (`printed_at`, `printed_targets`), `public.printers`.
- Produces:
  - `unprintedPaidOrders(tenantId: string): Promise<PrintableOrder[]>` — pedidos pagados cuyo `printed_targets` no cubre todas sus impresoras de destino
  - `reservePrinted(tenantId: string, orderId: string, printerId: string, at: string): Promise<void>` — registra que una impresora concreta imprimió el pedido, e idempotentemente pone `printed_at` cuando todas están cubiertas
  - `type PrintableOrder = { id: string; orderNumber: number; tableLabel: string|null; createdAt: string; printedTargets: Record<string,string>; items: PrintableItem[] }`

- [ ] **Step 1: Escribir el test que falla**

`tests/integration/print-jobs.test.ts` cubre, contra la base local:
- Un pedido pagado sin `printed_targets` aparece en `unprintedPaidOrders`.
- Tras `reservePrinted` de todas sus impresoras de destino, deja de aparecer y su `printed_at` queda puesto.
- `reservePrinted` de una sola impresora no pone `printed_at` si quedan otras pendientes: un fallo de barra no marca cocina como impresa.
- Llamar `reservePrinted` dos veces con la misma impresora es idempotente: `printed_targets` no acumula duplicados y el timestamp del primer registro se conserva.
- Un pedido de otro tenant nunca aparece en `unprintedPaidOrders` del primero (aislamiento).

Escribe estos casos con aserciones concretas, con control positivo donde toque (el pedido propio SÍ aparece antes de reservarlo).

- [ ] **Step 2: Implementar**

Transcribe el mecanismo de `GARUM/apps/desktop/src/main/realtime.ts:662-736` (`reservePrintAndDispatch`), adaptado a repositorio puro:
- `unprintedPaidOrders`: `tenantScoped("orders", tenantId)` con `status = 'paid'` y filtrado en servidor de los que ya tienen todas sus impresoras en `printed_targets`. Cruza con las impresoras de `printers` del tenant/venue por destino.
- `reservePrinted`: merge de `{ [printerId]: at }` en `printed_targets` (lectura-modificación-escritura acotada por tenant, o un update jsonb atómico), y cuando todas las impresoras de destino están presentes, `printed_at = now()` con guarda `.is('printed_at', null)` para no repisar.

Cuida la concurrencia: dos reservas simultáneas de impresoras distintas del mismo pedido no deben pisarse. Si el merge lectura-modificación-escritura tiene carrera, usa un update jsonb en una sola sentencia (`printed_targets || jsonb_build_object(...)`), o una función SQL. Demuéstralo con un test concurrente, como se hizo con el contador de pedidos.

- [ ] **Step 3: Verificar y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`

```bash
git add packages/db tests/integration/print-jobs.test.ts
git commit -m "feat(db): per-printer print reservation and unprinted-order recovery"
```

---

### Task 5: El flujo completo, extremo a extremo, sin hardware

Junta las cuatro tareas en una prueba que demuestra el objetivo de la fase: un pedido pagado se imprime, en la impresora correcta, una sola vez, y se recupera si la impresora estaba caída.

**Files:**
- Create: `tests/integration/print-flow.test.ts`

**Interfaces:**
- Consumes: `buildTicketLines` (`@suarex/ticket`), `printToPrinter` (`@suarex/printing`), `unprintedPaidOrders` / `reservePrinted` (`@suarex/db`), y el servidor ESC/POS falso.

- [ ] **Step 1: Escribir la prueba de flujo**

Con dos impresoras falsas (una "cocina", una "barra") y un pedido pagado con un ítem de cada destino:
- El flujo construye el ticket de cocina con la marca del tenant, lo renderiza, lo entrega a la impresora de cocina, y reserva. Lo mismo para barra.
- La impresora de cocina recibe el ítem de cocina y **no** el de barra, y viceversa. Ésta es la prueba de enrutado que de verdad importa.
- Ejecutar el flujo una segunda vez sobre el mismo pedido no vuelve a conectar con ninguna impresora (`connectionCount` no crece): la idempotencia funciona de punta a punta.
- **Recuperación:** con la impresora de cocina simulando un fallo de conexión la primera vez (`failNextConnection`), el pedido no se marca impreso para cocina; una segunda pasada —la que hará el reconciler— sí lo imprime y entonces sí lo marca. Barra, que sí imprimió a la primera, no se reimprime.

- [ ] **Step 2: Ejecutar y verificar**

Run: `pnpm test:integration -- tests/integration/print-flow.test.ts`
Expected: PASS

- [ ] **Step 3: Criterio de aceptación de la fase C1**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`
Expected: todo verde, cero saltados.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/print-flow.test.ts
git commit -m "test: end-to-end print flow with routing, idempotency and recovery"
```

---

## Verificación contra el spec

| Requisito del spec (fase C) | Cubierto en C1 | Dónde |
|---|---|---|
| Construir el ticket ESC/POS por tenant | Sí | Task 1 |
| Enrutado cocina/barra | Sí | Task 1, 5 |
| Entrega a impresora de red | Sí | Task 2 |
| Serialización por dispositivo | Sí | Task 2 |
| Emparejamiento por código, sin secretos en el instalable | Sí | Task 3 |
| Config de impresoras en base de datos | Sí | Task 3 |
| No perder un pedido cobrado (idempotencia + recuperación) | Sí | Task 4, 5 |
| Cuenta de servicio del dispositivo con RLS | Sí | Task 3 |

## Explícitamente en la fase C2, no aquí

- La cáscara Electron: proceso main, ventana, IPC, bandeja, primera ejecución que pide el código.
- El adaptador Windows RAW (winspool, PowerShell) para impresoras USB.
- Descubrimiento de impresoras en la LAN.
- Suscripción a Realtime en el proceso desktop y el reconciler que llama a `unprintedPaidOrders` en bucle.
- Telemetría (`desktop_heartbeat`, `desktop_logs`, `desktop_commands`) y comandos remotos.
- Auto-update con electron-updater.
- Empaquetado, firma e instalador NSIS.

Cada uno de esos requiere un Windows con impresora o un binario empaquetado, que solo el propietario puede validar. C2 se planifica cuando C1 esté cerrada, y su verificación incluye una lista de comprobación manual contra hardware real.
