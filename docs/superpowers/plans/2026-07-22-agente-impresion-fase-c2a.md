# Agente de impresión — Fase C2a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el núcleo headless del agente de impresión (`@suarex/agent`) que corre en el PC del cliente y, con su propio JWT de dispositivo, sondea sus pedidos pagados-sin-imprimir y los imprime en una impresora de red; y cerrar la deuda de seguridad del dispositivo (heartbeat, rate-limit del emparejamiento, reset de dispositivo, aviso de impresora mal configurada) — todo verificable en local sin hardware.

**Architecture:** El dispositivo lee con su JWT vía PostgREST (la RLS ya lo permite) reutilizando la MISMA función pura de selección que la ruta service-role, y marca impreso con la RPC `reserve_printed_self` que ya existe. El bucle del agente es un módulo Node (`@suarex/agent`) que Electron (C2b) hospedará después. Dos migraciones nuevas: `device_heartbeat` (RPC; las columnas ya existen) y el rate-limit del emparejamiento (tabla + RPC).

**Tech Stack:** pnpm workspaces + Turborepo, `@supabase/supabase-js` (cliente del dispositivo con anon key + credenciales), `@suarex/db`/`@suarex/printing`/`@suarex/ticket`/`@suarex/config` (reutilizados), Postgres (RPCs SECURITY DEFINER), Next 16 (route de pairing + Server Actions), Vitest (unit + integración), Playwright (no en C2a salvo aviso), Biome, TypeScript strict.

## Global Constraints

- **Prohibido tocar los repos/proyectos Supabase en producción.** Todo se demuestra en local con dispositivos y tenants de prueba.
- **El dispositivo/agente NUNCA tiene el service role.** `@suarex/agent` no importa nada que exponga la service key; lee con el JWT del dispositivo (RLS) y escribe solo por RPCs `SECURITY DEFINER` acotadas a su JWT (`reserve_printed_self`, `device_heartbeat`).
- **Una sola implementación de la lógica de cobertura.** La selección de "qué pedidos/impresoras faltan" se extrae a UNA función pura `selectUnprintedOrders` reutilizada por la ruta service-role y por la del dispositivo. NO se añade una RPC de lectura que reconstruya ese cálculo en SQL.
- **Semántica *at-least-once*:** el orden es entregar → marcar; un fallo entre ambos reimprime al reintentar (duplicado > perdido). La marca es por impresora (`reserve_printed_self`), así que solo se reintenta lo que falló.
- **Migraciones numeradas `20260722000009` en adelante.** El ordenamiento es por nombre de fichero completo; `20260722000009` es posterior a `20260722000008` y a `20260721000009` (fecha distinta), sin colisión.
- **RPCs nuevas:** `SECURITY DEFINER set search_path = ''`, aislamiento por `auth.uid()`/`current_tenant_id()` (nunca por un parámetro que controle el llamante), con `revoke ... from anon/public` + `grant` mínimo — mismo patrón que `reserve_printed_self` (`20260722000005`).
- **Textos de UI en castellano.** TDD: test que falla → verlo fallar → implementar → verlo pasar → commit. Commits frecuentes.

## Comandos del repo

- Migraciones + reseed local: `pnpm db:reset` (replay de todas las migraciones + `supabase/seed.sql`).
- Regenerar `.env.test`: `pnpm db:env`.
- Tests de integración (necesitan el stack local): `pnpm test:integration <filtro>` (ej. `pnpm test:integration agent-read`).
- Tests unitarios por paquete: `pnpm test` (turbo) o `pnpm --filter @suarex/<pkg> test`.
- Typecheck: `pnpm typecheck`. Lint: `pnpm lint`.

---

## Task 1: Extraer `selectUnprintedOrders` (función pura compartida)

**Files:**
- Modify: `packages/db/src/print-jobs.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/integration/agent-read.test.ts` (bloque `describe` puro, sin DB)

**Interfaces:**
- Produces:
  ```ts
  export type PaidOrderRow = { /* forma cruda de una fila de orders con joins, ver abajo */ };
  export type EnabledPrinterRow = { id: string; venue_id: string; destination: "cocina" | "barra" | "all" };
  export function selectUnprintedOrders(
    orderRows: PaidOrderRow[],
    printerRows: EnabledPrinterRow[],
  ): PrintableOrder[];
  ```
  `unprintedPaidOrders(tenantId)` (service-role, existente) pasa a: hacer los dos `select` y devolver `selectUnprintedOrders(orderRows, printerRows)`. Sin cambio de comportamiento — lo garantizan `tests/integration/print-jobs.test.ts` y `print-flow.test.ts`, que deben seguir en verde.
- `PaidOrderRow`/`EnabledPrinterRow` pasan de `type` privado a `export type` (los consume Task 2).

- [ ] **Step 1: Escribir el test puro que falla** — crear `tests/integration/agent-read.test.ts` con SOLO este bloque por ahora (es puro, no toca la DB, pero vive aquí porque `packages/db` no tiene runner de unit propio):

```ts
import { selectUnprintedOrders, type EnabledPrinterRow, type PaidOrderRow } from "@suarex/db";
import { describe, expect, it } from "vitest";

function order(overrides: Partial<PaidOrderRow>): PaidOrderRow {
  return {
    id: "o1",
    order_number: 1,
    created_at: "2026-01-01T00:00:00Z",
    printed_targets: {},
    venue_id: "v1",
    kitchen_status: "pending",
    bar_status: "na",
    tables: { label: "Mesa 1" },
    order_items: [
      { name_snapshot: { es: "Paella" }, quantity: 2, destination: "cocina", notes: null },
    ],
    ...overrides,
  };
}

const cocinaPrinter: EnabledPrinterRow = { id: "p-cocina", venue_id: "v1", destination: "cocina" };

describe("selectUnprintedOrders (pura)", () => {
  it("devuelve un pedido con impresora de destino aún no cubierta", () => {
    const result = selectUnprintedOrders([order({})], [cocinaPrinter]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "o1",
      orderNumber: 1,
      tableLabel: "Mesa 1",
      items: [{ name: "Paella", quantity: 2, destination: "cocina", notes: null }],
    });
  });

  it("excluye un pedido cuya impresora de destino ya está en printed_targets", () => {
    const covered = order({ printed_targets: { "p-cocina": "2026-01-01T00:01:00Z" } });
    expect(selectUnprintedOrders([covered], [cocinaPrinter])).toHaveLength(0);
  });

  it("excluye un pedido sin ninguna impresora de destino (estación sin impresora = trivialmente cubierta)", () => {
    // El pedido necesita cocina pero no hay impresora de cocina habilitada del mismo venue.
    expect(selectUnprintedOrders([order({})], [])).toHaveLength(0);
  });

  it("una impresora 'all' cubre cualquier estación usada", () => {
    const allPrinter: EnabledPrinterRow = { id: "p-all", venue_id: "v1", destination: "all" };
    const result = selectUnprintedOrders([order({})], [allPrinter]);
    expect(result).toHaveLength(1);
  });

  it("ignora impresoras de otro venue", () => {
    const otherVenue: EnabledPrinterRow = { id: "p-x", venue_id: "v2", destination: "cocina" };
    expect(selectUnprintedOrders([order({})], [otherVenue])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration agent-read`
Expected: FAIL (`selectUnprintedOrders`/`PaidOrderRow`/`EnabledPrinterRow` no exportados).

- [ ] **Step 3: Refactorizar `packages/db/src/print-jobs.ts`** — extraer la función pura sin cambiar el comportamiento. Cambios exactos:

Cambiar los `type PaidOrderRow`/`type EnabledPrinterRow` a `export type` (añadir `export` a ambas declaraciones existentes, líneas ~21 y ~38).

Justo ANTES de `export async function unprintedPaidOrders`, añadir la función pura extraída (mueve aquí el `.filter(...).map(...)` que hoy está dentro de `unprintedPaidOrders`):

```ts
/**
 * Núcleo PURO (sin I/O) de `unprintedPaidOrders`: dado el conjunto crudo de filas de
 * `orders` (pagadas y sin `printed_at`) y de `printers` habilitadas, decide qué pedidos
 * siguen pendientes de imprimir y los mapea a `PrintableOrder`. Extraído para que la ruta
 * del dispositivo (`@suarex/agent`, que lee con el JWT del device en vez del service role)
 * reutilice EXACTAMENTE esta lógica sin una tercera copia -- ver el razonamiento en
 * `docs/superpowers/specs/2026-07-22-agente-impresion-c2a-design.md`. El aislamiento por
 * tenant NO vive aquí: lo aplica quien hace los `select` (tenantScoped en la ruta
 * service-role, la RLS en la del dispositivo), así que esta función solo ve filas del
 * tenant correcto y no necesita conocer el `tenant_id`.
 */
export function selectUnprintedOrders(
  orderRows: PaidOrderRow[],
  printerRows: EnabledPrinterRow[],
): PrintableOrder[] {
  return orderRows
    .filter((row) => {
      const targets = targetPrinterIds(row, printerRows);
      if (targets.length === 0) return false; // nada que imprimir: no queda pendiente
      const covered = row.printed_targets ?? {};
      return !targets.every((id) => Object.hasOwn(covered, id));
    })
    .map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      tableLabel: row.tables?.label ?? null,
      createdAt: row.created_at,
      printedTargets: row.printed_targets ?? {},
      items: row.order_items.map((item) => ({
        name: resolveItemName(item.name_snapshot),
        quantity: item.quantity,
        destination: item.destination,
        notes: item.notes,
      })),
    }));
}
```

Y sustituir el cuerpo de `unprintedPaidOrders` (de `const printers = ...` al `return`) por:

```ts
  const printers = printerRows as unknown as EnabledPrinterRow[];
  return selectUnprintedOrders(orderRows as unknown as PaidOrderRow[], printers);
```
(Los dos `select` y sus comprobaciones de error quedan igual; solo cambia el bloque final `.filter/.map`.)

- [ ] **Step 4: Exportar** en `packages/db/src/index.ts`. En el bloque de `./print-jobs.js`, añadir los nuevos nombres. Sustituir:
```ts
export type { PrintableItem, PrintableOrder } from "./print-jobs.js";
export { reservePrinted, unprintedPaidOrders } from "./print-jobs.js";
```
por:
```ts
export type {
  EnabledPrinterRow,
  PaidOrderRow,
  PrintableItem,
  PrintableOrder,
} from "./print-jobs.js";
export { reservePrinted, selectUnprintedOrders, unprintedPaidOrders } from "./print-jobs.js";
```

- [ ] **Step 5: Ejecutar los tests + los de regresión**

Run: `pnpm test:integration agent-read && pnpm test:integration print-jobs && pnpm test:integration print-flow && pnpm typecheck`
Expected: PASS (los 5 casos puros nuevos + los existentes de print-jobs/print-flow sin cambios).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/print-jobs.ts packages/db/src/index.ts tests/integration/agent-read.test.ts
git commit -m "refactor(db): extract selectUnprintedOrders pure fn (shared service-role + device paths)"
```

---

## Task 2: Paquete `@suarex/agent` + lectura del dispositivo por JWT

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/vitest.config.ts`
- Create: `packages/agent/src/index.ts`
- Create: `packages/agent/src/agent-client.ts`
- Create: `packages/agent/src/device-orders.ts`
- Test: `tests/integration/agent-read.test.ts` (añadir bloque de integración con JWT)

**Interfaces:**
- Consumes: `selectUnprintedOrders`, `PrintableOrder` (`@suarex/db`); `@supabase/supabase-js`.
- Produces:
  ```ts
  // agent-client.ts
  export type AgentCredentials = { supabaseUrl: string; anonKey: string; email: string; password: string };
  export function createDeviceClient(creds: AgentCredentials): Promise<SupabaseClient>;
  // device-orders.ts
  export function unprintedPaidOrdersForDevice(client: SupabaseClient): Promise<PrintableOrder[]>;
  ```
  `createDeviceClient` crea un cliente con la anon key, inicia sesión con email/password del dispositivo y devuelve el cliente autenticado (lanza si el login falla). `unprintedPaidOrdersForDevice` hace los MISMOS dos `select` que `unprintedPaidOrders` pero sobre el cliente autenticado (la RLS lo acota al tenant del device) y devuelve `selectUnprintedOrders(...)`.

- [ ] **Step 1: Scaffold del paquete.** Crear `packages/agent/package.json`:

```json
{
  "name": "@suarex/agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@suarex/config": "workspace:*",
    "@suarex/db": "workspace:*",
    "@suarex/printing": "workspace:*",
    "@suarex/ticket": "workspace:*",
    "@supabase/supabase-js": "^2.95.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.5"
  }
}
```
Nota para el implementador: usa para `@supabase/supabase-js` la MISMA versión que ya declara `packages/db/package.json` (cópiala verbatim de ahí; el `^2.95.0` de arriba es orientativo). Igual para `@types/node`/`typescript`/`vitest`: copia las versiones que usa `packages/printing/package.json` para no divergir.

`packages/agent/tsconfig.json` (idéntico a `packages/printing/tsconfig.json`):
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src"] }
```

`packages/agent/vitest.config.ts` — copia el de `packages/printing/vitest.config.ts` verbatim (mismo runner de unit del paquete; los tests de integración del agente viven en `tests/integration`, no aquí).

`packages/agent/src/index.ts`:
```ts
export type { AgentCredentials } from "./agent-client.js";
export { createDeviceClient } from "./agent-client.js";
export { unprintedPaidOrdersForDevice } from "./device-orders.js";
```

- [ ] **Step 2: Registrar el paquete** — desde la raíz, `pnpm install` para que pnpm enlace el nuevo workspace. Verifica que aparece:

Run: `pnpm install && pnpm -r ls --depth -1 2>/dev/null | grep agent`
Expected: `@suarex/agent` listado.

- [ ] **Step 3: Escribir el test de integración que falla** — añadir a `tests/integration/agent-read.test.ts` (tras el bloque puro):

```ts
import { createDeviceClient, unprintedPaidOrdersForDevice } from "@suarex/agent";
import { unprintedPaidOrders } from "@suarex/db";
import { afterAll, beforeAll } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  deleteMembershipFixtureUser,
  nonce,
  signInAs,
  type TenantFixture,
} from "./helpers/tenants.js";

// --- helpers de siembra (un venue con un pedido pagado de cocina, sin imprimir) ---
async function seedPaidKitchenOrder(tenant: TenantFixture): Promise<string> {
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id").single();
  const venueId = venue?.id as string;
  const { data: cat } = await admin
    .from("categories")
    .insert({ tenant_id: tenant.tenantId, slug: `k-${nonce()}`, name_i18n: { es: "Cocina" }, destination: "cocina" })
    .select("id").single();
  const { data: prod } = await admin
    .from("products")
    .insert({ tenant_id: tenant.tenantId, category_id: cat?.id, name_i18n: { es: "Paella" }, price: 12 })
    .select("id").single();
  const { data: table } = await admin
    .from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: `mesa-${nonce()}` })
    .select("id").single();
  await admin.from("printers").insert({
    tenant_id: tenant.tenantId, venue_id: venueId, name: "Cocina",
    connection: { type: "network", host: "127.0.0.1", port: 9100 }, destination: "cocina", enabled: true,
  });
  const { createPendingOrder } = await import("@suarex/db");
  const order = await createPendingOrder({
    tenantId: tenant.tenantId, venueId, tableId: table?.id as string,
    lines: [{ productId: prod?.id as string, quantity: 1, extraIds: [], notes: null }], taxRate: 0.1,
  });
  await admin.from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.orderId);
  return order.orderId;
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;
const deviceUserIds: string[] = [];

beforeAll(async () => {
  tenantA = await createTenantFixture(`agr-a-${nonce()}`);
  tenantB = await createTenantFixture(`agr-b-${nonce()}`);
});
afterAll(async () => {
  for (const id of deviceUserIds) await deleteMembershipFixtureUser(id);
  if (tenantA) await deleteTenantFixture(tenantA);
  if (tenantB) await deleteTenantFixture(tenantB);
});

describe("unprintedPaidOrdersForDevice (JWT del device)", () => {
  it("un device del tenant A ve, con SU JWT, exactamente lo que ve la ruta service-role de A", async () => {
    const orderId = await seedPaidKitchenOrder(tenantA);
    // Sesión de dispositivo del tenant A (rol device, JWT con tenant_role=device).
    const deviceClient = await signInAs(tenantA.tenantId, "device");
    deviceUserIds.push(deviceClient.userId);

    const viaDevice = await unprintedPaidOrdersForDevice(deviceClient);
    const viaService = await unprintedPaidOrders(tenantA.tenantId);
    expect(viaDevice.map((o) => o.id).sort()).toEqual(viaService.map((o) => o.id).sort());
    expect(viaDevice.some((o) => o.id === orderId)).toBe(true);
  });

  it("un device del tenant B NO ve los pedidos de A (aislamiento por RLS)", async () => {
    const orderId = await seedPaidKitchenOrder(tenantA);
    const deviceB = await signInAs(tenantB.tenantId, "device");
    deviceUserIds.push(deviceB.userId);
    const viaDeviceB = await unprintedPaidOrdersForDevice(deviceB);
    expect(viaDeviceB.some((o) => o.id === orderId)).toBe(false);
  });
});
```

- [ ] **Step 4: Ejecutar y ver fallar**

Run: `pnpm test:integration agent-read`
Expected: FAIL (`@suarex/agent` no exporta `createDeviceClient`/`unprintedPaidOrdersForDevice`).

- [ ] **Step 5: Implementar `packages/agent/src/agent-client.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type AgentCredentials = {
  supabaseUrl: string;
  anonKey: string;
  email: string;
  password: string;
};

/**
 * Cliente Supabase del DISPOSITIVO: anon key + credenciales propias (las que devolvió el
 * emparejamiento). NUNCA la service key -- el PC del cliente jamás debe poseerla, y este
 * paquete no la importa por ningún lado. Inicia sesión y devuelve el cliente autenticado;
 * a partir de ahí toda lectura pasa por la RLS del rol `device`, y toda escritura por las
 * RPCs `SECURITY DEFINER` acotadas al JWT (`reserve_printed_self`, `device_heartbeat`).
 */
export async function createDeviceClient(creds: AgentCredentials): Promise<SupabaseClient> {
  const client = createClient(creds.supabaseUrl, creds.anonKey, {
    auth: { autoRefreshToken: true, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  });
  if (error) throw error;
  return client;
}
```

- [ ] **Step 6: Implementar `packages/agent/src/device-orders.ts`**

```ts
import { selectUnprintedOrders, type EnabledPrinterRow, type PaidOrderRow, type PrintableOrder } from "@suarex/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pedidos pagados-sin-imprimir del tenant del DISPOSITIVO, leídos con SU JWT. Hace los
 * mismos dos `select` que `unprintedPaidOrders` (`@suarex/db`) pero sobre el cliente
 * autenticado del device en vez del cliente service-role: la RLS del rol `device` ya
 * permite el SELECT abierto a todo el tenant en `orders`/`order_items`/`printers` (fencing
 * de D2), y lo acota a su propio tenant. La lógica de "qué falta por imprimir" NO se
 * duplica: se delega en `selectUnprintedOrders`, la misma función pura que usa la ruta
 * service-role.
 */
export async function unprintedPaidOrdersForDevice(
  client: SupabaseClient,
): Promise<PrintableOrder[]> {
  const { data: printerRows, error: printersError } = await client
    .from("printers")
    .select("id, venue_id, destination")
    .eq("enabled", true);
  if (printersError) throw printersError;

  const { data: orderRows, error: ordersError } = await client
    .from("orders")
    .select(
      "id, order_number, created_at, printed_targets, venue_id, kitchen_status, bar_status, " +
        "tables(label), order_items(name_snapshot, quantity, destination, notes)",
    )
    .not("paid_at", "is", null)
    .is("printed_at", null)
    .order("created_at", { ascending: true });
  if (ordersError) throw ordersError;

  return selectUnprintedOrders(
    orderRows as unknown as PaidOrderRow[],
    printerRows as unknown as EnabledPrinterRow[],
  );
}
```

- [ ] **Step 7: Ejecutar tests + typecheck + lint**

Run: `pnpm test:integration agent-read && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/agent tests/integration/agent-read.test.ts pnpm-lock.yaml
git commit -m "feat(agent): @suarex/agent package + device-JWT read (reuses selectUnprintedOrders)"
```

---

## Task 3: Bucle del agente (`runAgentTick` + `runAgent`)

**Files:**
- Create: `packages/agent/src/run-agent.ts`
- Modify: `packages/agent/src/index.ts`
- Test: `tests/integration/agent-loop.test.ts`

**Interfaces:**
- Consumes: `unprintedPaidOrdersForDevice`, `createDeviceClient` (Task 2); `printToPrinter`, `deviceKey`, `enqueueByDevice`, `type PrinterConfig` (`@suarex/printing`); `buildTicketLines`, `type TicketBranding`, `type TicketOrder` (`@suarex/ticket`); `parseBranding` (`@suarex/config`); `SupabaseClient`.
- Produces:
  ```ts
  export type AgentTickResult = { printed: number; failed: number };
  export function runAgentTick(client: SupabaseClient): Promise<AgentTickResult>;
  export function runAgent(creds: AgentCredentials, opts?: { pollMs?: number }): Promise<() => void>;
  ```
  `runAgentTick` hace UNA pasada (lee → por cada pedido/impresora de red pendiente: render → entrega TCP → si ok, `reserve_printed_self`) y devuelve cuántos tickets se imprimieron/fallaron. `runAgent` crea el cliente y arranca un `setInterval` de `pollMs` (por defecto 4000); devuelve una función para pararlo.

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/agent-loop.test.ts` (mira `tests/integration/print-flow.test.ts` como referencia del patrón de siembra e impresora falsa; aquí el flujo va por `runAgentTick` con el cliente del device):

```ts
import { createDeviceClient, runAgentTick } from "@suarex/agent";
import { afterEach, describe, expect, it } from "vitest";
import { startFakePrinter, type FakedPrinter } from "../helpers/fake-escpos-server.js";
import {
  admin,
  anonKeyForTest,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  supabaseUrlForTest,
  type TenantFixture,
} from "./helpers/tenants.js";

// Siembra un venue de cocina apuntando a una impresora TCP falsa, un pedido pagado,
// y un dispositivo (fila devices + cuenta de Auth con rol device) cuyo cliente devuelve.
type LoopFixture = {
  tenant: TenantFixture;
  orderId: string;
  deviceUserId: string;
  deviceEmail: string;
  devicePassword: string;
};

const openPrinters: FakedPrinter[] = [];
const fixtures: LoopFixture[] = [];

afterEach(async () => {
  await Promise.all(openPrinters.splice(0).map((p) => p.close()));
  for (const f of fixtures.splice(0)) {
    await deleteMembershipFixtureUser(f.deviceUserId);
    await deleteTenantFixture(f.tenant);
  }
});

async function seedLoop(kitchenPort: number): Promise<LoopFixture> {
  const tenant = await createTenantFixture(`loop-${nonce()}`);
  const { data: venue } = await admin.from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id").single();
  const venueId = venue?.id as string;
  const { data: cat } = await admin.from("categories")
    .insert({ tenant_id: tenant.tenantId, slug: `k-${nonce()}`, name_i18n: { es: "Cocina" }, destination: "cocina" })
    .select("id").single();
  const { data: prod } = await admin.from("products")
    .insert({ tenant_id: tenant.tenantId, category_id: cat?.id, name_i18n: { es: "Paella" }, price: 12 })
    .select("id").single();
  const { data: table } = await admin.from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: `mesa-${nonce()}` })
    .select("id").single();
  await admin.from("printers").insert({
    tenant_id: tenant.tenantId, venue_id: venueId, name: "Cocina",
    connection: { type: "network", host: "127.0.0.1", port: kitchenPort }, destination: "cocina", enabled: true,
  });
  const { createPendingOrder } = await import("@suarex/db");
  const order = await createPendingOrder({
    tenantId: tenant.tenantId, venueId, tableId: table?.id as string,
    lines: [{ productId: prod?.id as string, quantity: 1, extraIds: [], notes: null }], taxRate: 0.1,
  });
  await admin.from("orders").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", order.orderId);

  // Cuenta de Auth del dispositivo + membership rol device + fila devices enlazada.
  const email = `loop-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const deviceUserId = user?.user?.id as string;
  await admin.from("memberships").insert({ user_id: deviceUserId, tenant_id: tenant.tenantId, role: "device" });
  await admin.from("devices").insert({
    tenant_id: tenant.tenantId, venue_id: venueId, name: "Agente", auth_user_id: deviceUserId, paired_at: new Date().toISOString(),
  });
  return { tenant, orderId: order.orderId, deviceUserId, deviceEmail: email, devicePassword: password };
}

describe("runAgentTick", () => {
  it("imprime el pedido pagado en su impresora y lo marca; una segunda pasada no reimprime", async () => {
    const cocina = await startFakePrinter();
    openPrinters.push(cocina);
    const f = await seedLoop(cocina.port);
    fixtures.push(f);

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(), anonKey: anonKeyForTest(),
      email: f.deviceEmail, password: f.devicePassword,
    });

    const r1 = await runAgentTick(client);
    expect(r1.printed).toBe(1);
    expect(cocina.connectionCount()).toBe(1);
    expect(cocina.received().toString("latin1")).toContain("Paella");

    const { data: row } = await admin.from("orders").select("printed_at").eq("id", f.orderId).single();
    expect(row?.printed_at).not.toBeNull();

    const r2 = await runAgentTick(client);
    expect(r2.printed).toBe(0);
    expect(cocina.connectionCount()).toBe(1); // no reconecta
  });

  it("una impresora caída no se marca; el siguiente tick la reintenta", async () => {
    const cocina = await startFakePrinter();
    openPrinters.push(cocina);
    const f = await seedLoop(cocina.port);
    fixtures.push(f);
    cocina.failAllConnections();

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(), anonKey: anonKeyForTest(),
      email: f.deviceEmail, password: f.devicePassword,
    });

    const r1 = await runAgentTick(client);
    expect(r1.printed).toBe(0);
    expect(r1.failed).toBe(1);
    const { data: afterFail } = await admin.from("orders").select("printed_at").eq("id", f.orderId).single();
    expect(afterFail?.printed_at).toBeNull(); // NO se da por impreso

    cocina.recoverConnections();
    const r2 = await runAgentTick(client);
    expect(r2.printed).toBe(1);
    const { data: afterOk } = await admin.from("orders").select("printed_at").eq("id", f.orderId).single();
    expect(afterOk?.printed_at).not.toBeNull();
  }, 30_000); // los 3 reintentos con back-off real de printToPrinter
});
```

Nota: este test usa tres helpers que hay que añadir a `tests/integration/helpers/tenants.ts` si no existen: `supabaseUrlForTest()` → `process.env.SUPABASE_URL as string`, `anonKeyForTest()` → `process.env.SUPABASE_ANON_KEY as string`. Añádelos como funciones exportadas de una línea (mismo patrón que `anonClient`, que ya lee esas envs).

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration agent-loop`
Expected: FAIL (`runAgentTick` no existe).

- [ ] **Step 3: Implementar `packages/agent/src/run-agent.ts`**

```ts
import { parseBranding } from "@suarex/config";
import type { PrintableOrder } from "@suarex/db";
import { deviceKey, enqueueByDevice, type PrinterConfig, printToPrinter } from "@suarex/printing";
import { buildTicketLines, type TicketBranding, type TicketOrder } from "@suarex/ticket";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AgentCredentials, createDeviceClient } from "./agent-client.js";
import { unprintedPaidOrdersForDevice } from "./device-orders.js";

const DEFAULT_POLL_MS = 4000;

export type AgentTickResult = { printed: number; failed: number };

type PrinterRow = {
  id: string;
  destination: "cocina" | "barra" | "all";
  connection: { type?: string; host?: string; port?: number };
};

/** Cabecera del ticket a partir de la marca del tenant (nombre comercial), leída con el
 * JWT del device (la RLS le permite leer `tenant_settings`). Nunca lanza: si no hay marca,
 * la cabecera queda vacía. */
async function ticketBranding(client: SupabaseClient): Promise<TicketBranding> {
  const { data } = await client.from("tenant_settings").select("branding").maybeSingle();
  const name = parseBranding(data?.branding).name;
  return { header: name ?? "" };
}

/** Impresoras de RED habilitadas del tenant (las USB son C2b; se ignoran aquí). */
async function networkPrinters(client: SupabaseClient): Promise<PrinterRow[]> {
  const { data, error } = await client
    .from("printers")
    .select("id, destination, connection")
    .eq("enabled", true);
  if (error) throw error;
  return (data as unknown as PrinterRow[]).filter((p) => p.connection?.type === "network");
}

function toTicketOrder(order: PrintableOrder): TicketOrder {
  return {
    orderNumber: order.orderNumber,
    tableLabel: order.tableLabel,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      destination: item.destination,
      extras: [],
    })),
  };
}

/**
 * UNA pasada del agente: lee los pedidos pendientes con el JWT del device, y por cada
 * pedido y cada impresora de RED de destino que aún no conste en `printedTargets`, entrega
 * el ticket y, SOLO si la entrega tuvo éxito, marca esa impresora vía `reserve_printed_self`
 * (RPC, JWT del device -- nunca el service role). Orden entregar→marcar (at-least-once): un
 * fallo entre ambos reimprime en el siguiente tick, nunca pierde el ticket. La marca es por
 * impresora, así que un pedido con una impresora ok y otra caída solo reintenta la caída.
 */
export async function runAgentTick(client: SupabaseClient): Promise<AgentTickResult> {
  const [orders, printers, branding] = await Promise.all([
    unprintedPaidOrdersForDevice(client),
    networkPrinters(client),
    ticketBranding(client),
  ]);

  let printed = 0;
  let failed = 0;

  for (const order of orders) {
    const ticketOrder = toTicketOrder(order);
    const neededDestinations = new Set(order.items.map((i) => i.destination));
    for (const printer of printers) {
      const dest = printer.destination;
      const applies = dest === "all" || neededDestinations.has(dest);
      if (!applies) continue;
      if (Object.hasOwn(order.printedTargets, printer.id)) continue;

      // Para una impresora 'all', imprime cada destino que el pedido use.
      const renderDest = dest === "all" ? [...neededDestinations][0] : dest;
      const lines = buildTicketLines(ticketOrder, branding, renderDest);
      const config: PrinterConfig = {
        id: printer.id,
        label: printer.id,
        destination: dest,
        adapter: "escpos-tcp",
        host: printer.connection.host as string,
        port: printer.connection.port as number,
      };
      const result = await enqueueByDevice(deviceKey(config), () => printToPrinter(lines, config));
      if (result.ok) {
        const { error } = await client.rpc("reserve_printed_self", {
          p_order_id: order.id,
          p_printer_id: printer.id,
          p_at: new Date().toISOString(),
        });
        if (error) throw error;
        printed += 1;
      } else {
        failed += 1;
      }
    }
  }
  return { printed, failed };
}

/**
 * Arranca el agente: crea el cliente del dispositivo y sondea cada `pollMs`. Devuelve una
 * función para detenerlo (la usará la cáscara Electron de C2b al cerrarse). Un error en un
 * tick se registra pero no derriba el bucle -- el siguiente tick reintenta.
 */
export async function runAgent(
  creds: AgentCredentials,
  opts?: { pollMs?: number },
): Promise<() => void> {
  const client = await createDeviceClient(creds);
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // no solapar ticks
    running = true;
    try {
      await runAgentTick(client);
    } catch (error) {
      console.error("[agent] tick falló:", error);
    } finally {
      running = false;
    }
  }, pollMs);
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Exportar** en `packages/agent/src/index.ts` (añadir):
```ts
export type { AgentTickResult } from "./run-agent.js";
export { runAgent, runAgentTick } from "./run-agent.js";
```

- [ ] **Step 5: Verificar TicketOrder/TicketItem.** Abre `packages/ticket/src/types.ts` y confirma que `TicketOrder` acepta `{ orderNumber, tableLabel, createdAt, items: { name, quantity, destination, extras }[] }` y que `buildTicketLines(order, branding, destination)` toma un tercer argumento `"cocina" | "barra"`. Si algún nombre de campo difiere, ajusta `toTicketOrder`/`ticketBranding` a la forma real (el `print-flow.test.ts` de C1 los usa exactamente así, así que deberían casar).

- [ ] **Step 6: Ejecutar tests + typecheck + lint**

Run: `pnpm test:integration agent-loop && pnpm typecheck && pnpm lint`
Expected: PASS (ambos casos: impresión+idempotencia y caída+reintento).

- [ ] **Step 7: Commit**

```bash
git add packages/agent tests/integration/agent-loop.test.ts tests/integration/helpers/tenants.ts
git commit -m "feat(agent): runAgentTick/runAgent loop (poll, render, deliver TCP, reserve_printed_self, at-least-once)"
```

---

## Task 4: `device_heartbeat` RPC + wiring en el agente

**Files:**
- Create: `supabase/migrations/20260722000009_device_heartbeat.sql`
- Modify: `packages/agent/src/run-agent.ts` (llamar al heartbeat cada tick)
- Test: `tests/integration/device-heartbeat.test.ts`

**Interfaces:**
- Produces: RPC SQL `public.device_heartbeat(p_app_version text) returns void`, grant a `authenticated`. `runAgentTick` llama `client.rpc("device_heartbeat", { p_app_version: null })` al final de cada pasada (no lanza si falla: el heartbeat es informativo, no debe derribar la impresión).

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/device-heartbeat.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anonClient,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenant: TenantFixture;
const userIds: string[] = [];

beforeAll(async () => {
  tenant = await createTenantFixture(`hb-${nonce()}`);
});
afterAll(async () => {
  for (const id of userIds) await deleteMembershipFixtureUser(id);
  if (tenant) await deleteTenantFixture(tenant);
});

// Crea un device (cuenta Auth + membership device + fila devices enlazada) y devuelve un
// cliente autenticado como ese device.
async function seedDeviceClient(venueId: string) {
  const email = `hb-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const userId = user?.user?.id as string;
  userIds.push(userId);
  await admin.from("memberships").insert({ user_id: userId, tenant_id: tenant.tenantId, role: "device" });
  const { data: device } = await admin.from("devices")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Agente", auth_user_id: userId })
    .select("id").single();
  const client = anonClient();
  await client.auth.signInWithPassword({ email, password });
  return { client, userId, deviceId: device?.id as string };
}

describe("device_heartbeat", () => {
  it("actualiza last_seen_at y app_version SOLO de la fila propia del device", async () => {
    const { data: venue } = await admin.from("venues")
      .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
      .select("id").single();
    const venueId = venue?.id as string;

    const a = await seedDeviceClient(venueId);
    const b = await seedDeviceClient(venueId);

    const { error } = await a.client.rpc("device_heartbeat", { p_app_version: "1.2.3" });
    expect(error).toBeNull();

    const { data: rowA } = await admin.from("devices").select("last_seen_at, app_version").eq("id", a.deviceId).single();
    expect(rowA?.app_version).toBe("1.2.3");
    expect(rowA?.last_seen_at).not.toBeNull();

    // La fila del OTRO device no se tocó.
    const { data: rowB } = await admin.from("devices").select("last_seen_at, app_version").eq("id", b.deviceId).single();
    expect(rowB?.app_version).toBeNull();
    expect(rowB?.last_seen_at).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration device-heartbeat`
Expected: FAIL (`device_heartbeat` no existe → error de Postgres "function ... does not exist").

- [ ] **Step 3: Escribir la migración** `supabase/migrations/20260722000009_device_heartbeat.sql`:

```sql
-- C2a: heartbeat del dispositivo. La RLS del rol `device` es de solo lectura sobre su
-- propia fila (`devices_select_own`, 20260722000005); un heartbeat necesita ESCRIBIR
-- `last_seen_at`/`app_version` en esa fila, acotado a esas dos columnas -- algo que la RLS
-- por fila no expresa. Se resuelve con una RPC SECURITY DEFINER que actualiza SOLO esas
-- dos columnas y SOLO la fila cuyo `auth_user_id = auth.uid()` (el propio device). Las
-- columnas ya existen (20260722000001_devices_printers.sql), así que esto solo añade la
-- función y su grant. Mismo patrón de aislamiento por JWT que `reserve_printed_self`.
create or replace function public.device_heartbeat(p_app_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.devices
     set last_seen_at = now(),
         app_version = coalesce(p_app_version, app_version)
   where auth_user_id = auth.uid();
end;
$$;

revoke execute on function public.device_heartbeat (text) from anon, public;
grant execute on function public.device_heartbeat (text) to authenticated;
```

- [ ] **Step 4: Aplicar la migración y ver pasar**

Run: `pnpm db:reset && pnpm db:env && pnpm test:integration device-heartbeat`
Expected: PASS.

- [ ] **Step 5: Wiring en el agente** — en `packages/agent/src/run-agent.ts`, al final de `runAgentTick`, ANTES del `return`, añadir el heartbeat (no debe derribar la impresión si falla):

```ts
  // Heartbeat informativo: nunca derriba el tick.
  await client.rpc("device_heartbeat", { p_app_version: null }).catch(() => {});
```
(Colócalo justo antes de `return { printed, failed };`.)

- [ ] **Step 6: Ejecutar la regresión del bucle + typecheck**

Run: `pnpm test:integration agent-loop && pnpm typecheck`
Expected: PASS (el bucle sigue verde con el heartbeat añadido).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260722000009_device_heartbeat.sql packages/agent/src/run-agent.ts tests/integration/device-heartbeat.test.ts
git commit -m "feat(devices): device_heartbeat RPC (own row, two columns) + agent emits it each tick"
```

---

## Task 5: Rate-limit del emparejamiento

**Files:**
- Create: `supabase/migrations/20260722000010_pair_rate_limit.sql`
- Modify: `packages/db/src/client.ts` (accesor `pairRateLimitRpc`)
- Create: `packages/db/src/pair-rate-limit.ts`
- Modify: `packages/db/src/index.ts`
- Create: `apps/web/lib/client-ip.ts`
- Modify: `apps/web/app/api/devices/pair/route.ts`
- Test: `tests/integration/pair-rate-limit.test.ts`

**Interfaces:**
- Produces:
  - SQL `public.check_pair_rate_limit(p_ip text, p_window_seconds int, p_max int) returns boolean` — `true` si el intento está permitido, `false` si superó `p_max` dentro de la ventana. Grant solo a `service_role`.
  - `checkPairRateLimit(ip: string): Promise<boolean>` (`packages/db`) — envuelve la RPC con ventana 60 s y máx 10, vía service role.
  - `getClientIp(request: Request): string` (`apps/web/lib/client-ip.ts`).

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/pair-rate-limit.test.ts`:

```ts
import { checkPairRateLimit } from "@suarex/db";
import { admin } from "./helpers/tenants.js";
import { afterEach, describe, expect, it } from "vitest";

// Cada test usa una IP única para no chocar con otras corridas/ficheros.
const usedIps: string[] = [];
afterEach(async () => {
  for (const ip of usedIps.splice(0)) {
    await admin.from("pair_attempts").delete().eq("ip", ip);
  }
});

describe("checkPairRateLimit", () => {
  it("permite hasta el máximo y bloquea el siguiente en la misma ventana", async () => {
    const ip = `1.2.3.${Math.floor(Math.random() * 1000)}-${Date.now()}`;
    usedIps.push(ip);
    // Con la RPC directa acotamos la ventana a 60s y el máximo a 3 para el test.
    const call = () => admin.rpc("check_pair_rate_limit", { p_ip: ip, p_window_seconds: 60, p_max: 3 });
    expect((await call()).data).toBe(true);  // 1
    expect((await call()).data).toBe(true);  // 2
    expect((await call()).data).toBe(true);  // 3
    expect((await call()).data).toBe(false); // 4 -> bloqueado
  });

  it("una IP distinta no se ve afectada", async () => {
    const ipA = `9.9.9.${Date.now()}`;
    const ipB = `8.8.8.${Date.now()}`;
    usedIps.push(ipA, ipB);
    await admin.rpc("check_pair_rate_limit", { p_ip: ipA, p_window_seconds: 60, p_max: 1 });
    await admin.rpc("check_pair_rate_limit", { p_ip: ipA, p_window_seconds: 60, p_max: 1 }); // ipA bloqueada
    const { data } = await admin.rpc("check_pair_rate_limit", { p_ip: ipB, p_window_seconds: 60, p_max: 1 });
    expect(data).toBe(true); // ipB sigue permitida
  });

  it("pasada la ventana, el contador reinicia", async () => {
    const ip = `7.7.7.${Date.now()}`;
    usedIps.push(ip);
    await admin.rpc("check_pair_rate_limit", { p_ip: ip, p_window_seconds: 60, p_max: 1 });
    const blocked = await admin.rpc("check_pair_rate_limit", { p_ip: ip, p_window_seconds: 60, p_max: 1 });
    expect(blocked.data).toBe(false);
    // Simula que la ventana ya pasó retrasando window_start.
    await admin.from("pair_attempts").update({ window_start: new Date(Date.now() - 120_000).toISOString() }).eq("ip", ip);
    const afterWindow = await admin.rpc("check_pair_rate_limit", { p_ip: ip, p_window_seconds: 60, p_max: 1 });
    expect(afterWindow.data).toBe(true); // reiniciado
  });

  it("el wrapper checkPairRateLimit usa ventana 60s y máx 10", async () => {
    const ip = `5.5.5.${Date.now()}`;
    usedIps.push(ip);
    let last = true;
    for (let i = 0; i < 11; i += 1) last = await checkPairRateLimit(ip);
    expect(last).toBe(false); // el 11º supera el máx de 10
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration pair-rate-limit`
Expected: FAIL (`check_pair_rate_limit` no existe / `checkPairRateLimit` no exportado).

- [ ] **Step 3: Escribir la migración** `supabase/migrations/20260722000010_pair_rate_limit.sql`:

```sql
-- C2a: rate-limit del endpoint público POST /api/devices/pair. Los códigos ya son de 192
-- bits + TTL de 15 min (fuerza bruta inviable); esto es defensa en profundidad contra
-- abuso de volumen. Contador por ventana fija en Postgres (durable y compartido entre
-- instancias -- un límite en memoria de proceso sería inútil en serverless). No es una
-- tabla tenant-scoped (no tiene `tenant_id`): la RLS se habilita y se deniega todo a
-- anon/authenticated; solo el service role (vía la RPC + el endpoint) la toca.
create table public.pair_attempts (
  ip text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table public.pair_attempts enable row level security;
revoke all on public.pair_attempts from anon, authenticated;

-- Incrementa el contador de `p_ip` en su ventana actual y devuelve si el intento está
-- permitido. Si la ventana venció (window_start más viejo que p_window_seconds), reinicia
-- a 1. Todo en una sola sentencia con ON CONFLICT: el UPDATE toma el lock de fila, así que
-- dos peticiones concurrentes de la misma IP se serializan y ninguna pierde su cuenta.
create or replace function public.check_pair_rate_limit(
  p_ip text,
  p_window_seconds int,
  p_max int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.pair_attempts (ip, window_start, count)
    values (p_ip, now(), 1)
  on conflict (ip) do update set
    window_start = case
      when public.pair_attempts.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else public.pair_attempts.window_start
    end,
    count = case
      when public.pair_attempts.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else public.pair_attempts.count + 1
    end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke execute on function public.check_pair_rate_limit (text, int, int) from anon, authenticated, public;
grant execute on function public.check_pair_rate_limit (text, int, int) to service_role;
```

- [ ] **Step 4: Accesor + wrapper en `packages/db`.** En `packages/db/src/client.ts`, al final, añadir:

```ts
/**
 * UNDÉCIMA EXENCIÓN DELIBERADA. `check_pair_rate_limit` es SECURITY DEFINER y no depende de
 * ningún tenant (limita por IP el endpoint público de emparejamiento); se concede solo a
 * `service_role`. Acotado por firma a `checkPairRateLimit` (`src/pair-rate-limit.ts`).
 */
export function pairRateLimitRpc(ip: string, windowSeconds: number, max: number) {
  return serviceClient().rpc("check_pair_rate_limit", {
    p_ip: ip,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
}
```

Crear `packages/db/src/pair-rate-limit.ts`:
```ts
import { pairRateLimitRpc } from "./client.js";

/** Ventana y tope del rate-limit del emparejamiento: 10 intentos por IP cada 60 s.
 * Defensa en profundidad -- ver `20260722000010_pair_rate_limit.sql`. */
const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 10;

/** `true` si el intento de emparejamiento desde `ip` está permitido; `false` si superó el
 * tope de la ventana. Un fallo de la RPC se propaga (el endpoint decide qué hacer). */
export async function checkPairRateLimit(ip: string): Promise<boolean> {
  const { data, error } = await pairRateLimitRpc(ip, WINDOW_SECONDS, MAX_ATTEMPTS);
  if (error) throw error;
  return data === true;
}
```

Exportar en `packages/db/src/index.ts`:
```ts
export { checkPairRateLimit } from "./pair-rate-limit.js";
```

- [ ] **Step 5: Aplicar migración y ver pasar los 4 casos**

Run: `pnpm db:reset && pnpm db:env && pnpm test:integration pair-rate-limit`
Expected: PASS.

- [ ] **Step 6: IP del cliente + endpoint.** Crear `apps/web/lib/client-ip.ts`:
```ts
/** IP del cliente para el rate-limit: primer salto de `x-forwarded-for` (lo que fija el
 * proxy/plataforma), con `x-real-ip` de respaldo. `"unknown"` si no hay ninguna -- todos
 * los clientes sin IP comparten cubo, lo cual es aceptable para un límite anti-abuso. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
```

Modificar `apps/web/app/api/devices/pair/route.ts`: importar `checkPairRateLimit` y `getClientIp`, y comprobar el límite ANTES de `pairDevice`. Añadir tras los imports una respuesta 429, y al principio de `POST` (tras validar `pairingCode`):

```ts
import { checkPairRateLimit, pairDevice } from "@suarex/db";
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/client-ip";

function notFound() {
  return NextResponse.json({ error: "Código de emparejamiento inválido" }, { status: 404 });
}

function tooManyRequests() {
  return NextResponse.json({ error: "Demasiados intentos, prueba más tarde" }, { status: 429 });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { pairingCode?: unknown } | null;
  const pairingCode = typeof body?.pairingCode === "string" ? body.pairingCode : null;

  if (!pairingCode) {
    return notFound();
  }

  // Rate-limit por IP: defensa en profundidad. Un fallo de la comprobación NO abre la
  // puerta (fail-closed) -- se colapsa al 404 uniforme, registrando el fallo real.
  try {
    const allowed = await checkPairRateLimit(getClientIp(request));
    if (!allowed) return tooManyRequests();
  } catch (error) {
    console.error("[devices] Error en rate-limit de emparejamiento:", error);
    return notFound();
  }

  let result: Awaited<ReturnType<typeof pairDevice>>;
  try {
    result = await pairDevice(pairingCode);
  } catch (error) {
    console.error("[devices] Error emparejando dispositivo:", error);
    return notFound();
  }

  if (!result) {
    return notFound();
  }

  return NextResponse.json({
    deviceId: result.deviceId,
    email: result.email,
    password: result.password,
    tenantId: result.tenantId,
  });
}
```

- [ ] **Step 7: Typecheck + lint + regresión de anti-fuga**

Run: `pnpm typecheck && pnpm lint && pnpm test:integration tenant-isolation`
Expected: PASS (la nueva tabla `pair_attempts` no es tenant-scoped, así que la suite anti-fuga no la exige con policy de tenant; confirma que sigue verde).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260722000010_pair_rate_limit.sql packages/db/src/client.ts packages/db/src/pair-rate-limit.ts packages/db/src/index.ts apps/web/lib/client-ip.ts apps/web/app/api/devices/pair/route.ts tests/integration/pair-rate-limit.test.ts
git commit -m "feat(devices): rate-limit POST /api/devices/pair (durable Postgres window, 429)"
```

---

## Task 6: Resetear dispositivo (revocar + nuevo código)

**Files:**
- Modify: `packages/db/src/client.ts` (accesor `authAdminForDeviceReset`)
- Modify: `packages/db/src/admin-devices.ts` (`resetDevice`)
- Modify: `packages/db/src/index.ts`
- Modify: `apps/web/app/admin/dispositivos/actions.ts` (`resetDeviceAction`)
- Modify: `apps/web/app/admin/dispositivos/DeviceRow.tsx` (botón)
- Test: `tests/integration/device-reset.test.ts`

**Interfaces:**
- Consumes: `tenantScoped`, `authAdminForDevicePairing` pattern (`client.ts`); `generatePairingCode`/`resolveTtlMinutes` (existentes en `admin-devices.ts`, privadas — se reutilizan dentro del mismo módulo); `managerAction` (`require-manager.ts`).
- Produces:
  ```ts
  export function resetDevice(tenantId: string, deviceId: string): Promise<{ pairingCode: string; expiresAt: string }>;
  export const resetDeviceAction: (formData: FormData) => Promise<{ pairingCode: string; expiresAt: string }>;
  ```
  `resetDevice`: borra la cuenta de Auth del device (`deleteUser` → revoca refresh tokens + cascada de `memberships`/`auth_user_id`), lo desempareja y emite un código nuevo. Idempotente si el device nunca estuvo emparejado (no hay cuenta que borrar).

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/device-reset.test.ts`:

```ts
import { pairDevice, resetDevice } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anonClient,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenant: TenantFixture;
let venueId: string;
const orphanUserIds: string[] = [];

beforeAll(async () => {
  tenant = await createTenantFixture(`reset-${nonce()}`);
  const { data: venue } = await admin.from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "v", name: "V", is_default: true })
    .select("id").single();
  venueId = venue?.id as string;
});
afterAll(async () => {
  for (const id of orphanUserIds) await admin.auth.admin.deleteUser(id).catch(() => {});
  if (tenant) await deleteTenantFixture(tenant);
});

async function newPairedDevice(): Promise<{ deviceId: string; email: string; password: string; userId: string }> {
  const code = `RESET-${nonce()}`;
  const { data: device } = await admin.from("devices")
    .insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "Agente",
      pairing_code: code, pairing_expires_at: new Date(Date.now() + 60_000).toISOString(),
    })
    .select("id").single();
  const result = await pairDevice(code);
  const { data: row } = await admin.from("devices").select("auth_user_id").eq("id", device?.id).single();
  return {
    deviceId: device?.id as string,
    email: result?.email as string,
    password: result?.password as string,
    userId: row?.auth_user_id as string,
  };
}

describe("resetDevice", () => {
  it("borra la cuenta, desempareja y emite un código nuevo; las credenciales viejas ya no sirven", async () => {
    const dev = await newPairedDevice();

    // Antes del reset, las credenciales viejas inician sesión.
    const before = anonClient();
    const { error: beforeErr } = await before.auth.signInWithPassword({ email: dev.email, password: dev.password });
    expect(beforeErr).toBeNull();

    const { pairingCode, expiresAt } = await resetDevice(tenant.tenantId, dev.deviceId);
    expect(pairingCode.length).toBeGreaterThanOrEqual(32);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    // La cuenta de Auth vieja ya no existe → membership borrada, auth_user_id a null.
    const { data: userRow } = await admin.auth.admin.getUserById(dev.userId);
    expect(userRow?.user).toBeNull();
    const { data: memberships } = await admin.from("memberships").select("user_id").eq("user_id", dev.userId);
    expect(memberships).toHaveLength(0);
    const { data: deviceRow } = await admin.from("devices").select("auth_user_id, paired_at, pairing_code").eq("id", dev.deviceId).single();
    expect(deviceRow?.auth_user_id).toBeNull();
    expect(deviceRow?.paired_at).toBeNull();
    expect(deviceRow?.pairing_code).toBe(pairingCode);

    // Credenciales viejas ya no inician sesión (usuario borrado).
    const after = anonClient();
    const { error: afterErr } = await after.auth.signInWithPassword({ email: dev.email, password: dev.password });
    expect(afterErr).not.toBeNull();

    // El código nuevo empareja un "PC de repuesto" con credenciales frescas que resuelven el tenant.
    const fresh = await pairDevice(pairingCode);
    expect(fresh?.tenantId).toBe(tenant.tenantId);
    if (fresh) orphanUserIds.push(""); // marcador; el borrado real va por deleteTenantFixture (cascada)
    const client = anonClient();
    const { error: freshErr } = await client.auth.signInWithPassword({ email: fresh?.email as string, password: fresh?.password as string });
    expect(freshErr).toBeNull();
  });

  it("un device nunca emparejado se resetea sin error (no hay cuenta que borrar)", async () => {
    const { data: device } = await admin.from("devices")
      .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Sin emparejar" })
      .select("id").single();
    const { pairingCode } = await resetDevice(tenant.tenantId, device?.id as string);
    expect(pairingCode.length).toBeGreaterThanOrEqual(32);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration device-reset`
Expected: FAIL (`resetDevice` no exportada).

- [ ] **Step 3: Accesor en `packages/db/src/client.ts`** (al final):

```ts
/**
 * DUODÉCIMA EXENCIÓN DELIBERADA, mismo razonamiento que `authAdminForDevicePairing` pero
 * para el reset: `resetDevice` (`src/admin-devices.ts`) borra la cuenta de Auth del
 * dispositivo (`deleteUser`) para revocar sus refresh tokens y su membership al dar de baja
 * o sustituir el PC. Acotado por firma a ese único uso; no se reutiliza el de pairing para
 * que cada punto que borra cuentas de Auth sea rastreable a un caller.
 */
export function authAdminForDeviceReset() {
  return serviceClient().auth.admin;
}
```

- [ ] **Step 4: Implementar `resetDevice` en `packages/db/src/admin-devices.ts`.** Al principio del fichero, añadir el import del accesor (junto al `tenantScoped` existente):
```ts
import { authAdminForDeviceReset, tenantScoped } from "./client.js";
```
Y al final del fichero, la función (reutiliza `generatePairingCode` y `resolveTtlMinutes`, ya definidas arriba en el mismo módulo):

```ts
/**
 * Resetea un dispositivo YA emparejado (robo, o cambio de PC). En un solo flujo:
 *   1. Si tiene cuenta de Auth, la BORRA (`deleteUser`) -- revoca sus refresh tokens y, en
 *      cascada, elimina su `memberships` (FK on delete cascade) y pone `auth_user_id` a null
 *      (FK on delete set null). LÍMITE HONESTO (JWT stateless): esto NO invalida un access
 *      token ya emitido antes de que caduque; lo que revoca de inmediato es la capacidad de
 *      RENOVAR y la membership. El PC robado pierde acceso como muy tarde al caducar su
 *      token en curso (TTL del proyecto). Mismo tipo de límite honesto que el ACK de
 *      impresión de C1.
 *   2. Desempareja (`paired_at = null`) y emite un código nuevo, para un PC de repuesto.
 * `deviceId` de otro tenant no casa el `tenantScoped` → no borra ni resetea nada ajeno.
 */
export async function resetDevice(
  tenantId: string,
  deviceId: string,
): Promise<{ pairingCode: string; expiresAt: string }> {
  const { data: device, error: readError } = await tenantScoped("devices", tenantId)
    .select("id, auth_user_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (readError) throw readError;
  if (!device) throw new Error("Dispositivo no encontrado en este tenant.");

  const authUserId = (device as { auth_user_id: string | null }).auth_user_id;
  if (authUserId) {
    const { error: deleteError } = await authAdminForDeviceReset().deleteUser(authUserId);
    if (deleteError) throw deleteError;
  }

  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + resolveTtlMinutes(undefined) * 60_000).toISOString();
  const { error: updateError } = await tenantScoped("devices", tenantId)
    .update({ paired_at: null, auth_user_id: null, pairing_code: pairingCode, pairing_expires_at: expiresAt })
    .eq("id", deviceId);
  if (updateError) throw updateError;

  return { pairingCode, expiresAt };
}
```

Exportar en `packages/db/src/index.ts` (en el bloque de `./admin-devices.js`):
```ts
export { createDevice, deleteDevice, listDevices, regeneratePairingCode, resetDevice } from "./admin-devices.js";
```

- [ ] **Step 5: Ejecutar y ver pasar**

Run: `pnpm test:integration device-reset && pnpm typecheck`
Expected: PASS (ambos casos).

- [ ] **Step 6: Server Action** — en `apps/web/app/admin/dispositivos/actions.ts`, importar `resetDevice` y añadir la action (devuelve el código, como `createDeviceAction`):

```ts
export const resetDeviceAction = managerAction(
  async (session, formData: FormData): Promise<{ pairingCode: string; expiresAt: string }> => {
    const deviceId = requiredString(formData, "device_id");
    const result = await resetDevice(session.tenantId, deviceId);
    revalidatePath("/admin/dispositivos");
    return result;
  },
);
```
(Añade `resetDevice` al import de `@suarex/db` que ya trae `createDevice`/etc.)

- [ ] **Step 7: Botón en `DeviceRow.tsx`.** Un dispositivo emparejado (`device.pairedAt`) no muestra "Regenerar código" (rechaza), pero SÍ debe mostrar "Resetear dispositivo". Añadir el import y un formulario con `useActionState` reutilizando el `PairingCodeView` para mostrar el código nuevo. Cambios:

Import (junto a los existentes):
```ts
import { deleteDeviceAction, regeneratePairingCodeAction, resetDeviceAction } from "./actions";
```
Añadir, dentro del componente `DeviceRow`, un segundo `useActionState` para el reset:
```ts
  const [resetPairing, resetAction, isResetting] = useActionState(
    async (_prev: PairingState, formData: FormData): Promise<PairingState> => resetDeviceAction(formData),
    null,
  );
```
Y en el JSX, tras el bloque de "Regenerar código" (`{device.pairedAt ? null : (...)}`), añadir el bloque simétrico para dispositivos emparejados:
```tsx
      {device.pairedAt ? (
        <>
          {resetPairing ? (
            <PairingCodeView pairingCode={resetPairing.pairingCode} expiresAt={resetPairing.expiresAt} />
          ) : null}
          <form action={resetAction}>
            <input type="hidden" name="device_id" value={device.id} />
            <button
              type="submit"
              disabled={isResetting}
              onClick={(e) => {
                if (
                  !window.confirm(
                    `Resetear "${device.name}" revoca el acceso del PC actual (deja de poder renovar su sesión) y genera un código nuevo para emparejar otro PC. Úsalo si el equipo se ha perdido o se sustituye. ¿Continuar?`,
                  )
                ) {
                  e.preventDefault();
                }
              }}
            >
              Resetear dispositivo
            </button>
          </form>
        </>
      ) : null}
```

- [ ] **Step 8: Verificar build + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/client.ts packages/db/src/admin-devices.ts packages/db/src/index.ts apps/web/app/admin/dispositivos/actions.ts apps/web/app/admin/dispositivos/DeviceRow.tsx tests/integration/device-reset.test.ts
git commit -m "feat(devices): resetDevice (deleteUser revokes + unpair + new code) + panel button"
```

---

## Task 7: Aviso de impresora mal configurada

**Files:**
- Create: `packages/db/src/printer-coverage.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/web/app/admin/impresoras/page.tsx`
- Test: `tests/integration/printer-coverage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function destinationsMissingPrinter(tenantId: string): Promise<("cocina" | "barra")[]>;
  ```
  Devuelve los destinos que la carta del tenant usa (distinct `categories.destination`) para los que NO hay ninguna impresora habilitada (`printers.enabled = true`, `destination` = ese o `'all'`). Vacío = todo cubierto.

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/printer-coverage.test.ts`:

```ts
import { destinationsMissingPrinter } from "@suarex/db";
import { afterEach, describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

const fixtures: TenantFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await deleteTenantFixture(f);
});

async function seedVenue(tenant: TenantFixture): Promise<string> {
  const { data: venue } = await admin.from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id").single();
  return venue?.id as string;
}

describe("destinationsMissingPrinter", () => {
  it("avisa de un destino que la carta usa pero sin impresora habilitada", async () => {
    const tenant = await createTenantFixture(`cov-${nonce()}`);
    fixtures.push(tenant);
    await seedVenue(tenant);
    // La carta usa cocina...
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId, slug: `k-${nonce()}`, name_i18n: { es: "Cocina" }, destination: "cocina",
    });
    // ...pero no hay ninguna impresora.
    expect(await destinationsMissingPrinter(tenant.tenantId)).toEqual(["cocina"]);
  });

  it("no avisa cuando el destino tiene una impresora habilitada", async () => {
    const tenant = await createTenantFixture(`cov2-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId, slug: `k-${nonce()}`, name_i18n: { es: "Cocina" }, destination: "cocina",
    });
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "Cocina",
      connection: { type: "network", host: "127.0.0.1", port: 9100 }, destination: "cocina", enabled: true,
    });
    expect(await destinationsMissingPrinter(tenant.tenantId)).toEqual([]);
  });

  it("una impresora 'all' cubre cualquier destino usado", async () => {
    const tenant = await createTenantFixture(`cov3-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId, slug: `b-${nonce()}`, name_i18n: { es: "Barra" }, destination: "barra",
    });
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "Todo",
      connection: { type: "network", host: "127.0.0.1", port: 9100 }, destination: "all", enabled: true,
    });
    expect(await destinationsMissingPrinter(tenant.tenantId)).toEqual([]);
  });

  it("una impresora deshabilitada no cubre", async () => {
    const tenant = await createTenantFixture(`cov4-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await admin.from("categories").insert({
      tenant_id: tenant.tenantId, slug: `k-${nonce()}`, name_i18n: { es: "Cocina" }, destination: "cocina",
    });
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "Cocina apagada",
      connection: { type: "network", host: "127.0.0.1", port: 9100 }, destination: "cocina", enabled: false,
    });
    expect(await destinationsMissingPrinter(tenant.tenantId)).toEqual(["cocina"]);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration printer-coverage`
Expected: FAIL (`destinationsMissingPrinter` no exportada).

- [ ] **Step 3: Implementar `packages/db/src/printer-coverage.ts`**

```ts
import { tenantScoped } from "./client.js";

type CategoryDestinationRow = { destination: "cocina" | "barra" | null };
type EnabledPrinterDestRow = { destination: "cocina" | "barra" | "all" };

/**
 * Destinos que la carta del tenant USA (distinct `categories.destination`) pero para los
 * que NO hay ninguna impresora habilitada que los cubra (una impresora de ese `destination`
 * o una `'all'`). Un resultado no vacío es exactamente el caso de "estación sin impresora"
 * que hoy `unprintedPaidOrders`/`reserve_printed` tratan como trivialmente cubierto y
 * descartan en silencio (ver el trade-off documentado en `print-jobs.ts`): el panel de
 * impresoras lo muestra como aviso para que el `owner` lo corrija, cerrando el deferred item.
 * Es una comprobación de solo lectura; no cambia el comportamiento del agente.
 */
export async function destinationsMissingPrinter(
  tenantId: string,
): Promise<("cocina" | "barra")[]> {
  const { data: catRows, error: catError } = await tenantScoped("categories", tenantId)
    .select("destination");
  if (catError) throw catError;

  const { data: printerRows, error: printerError } = await tenantScoped("printers", tenantId)
    .select("destination")
    .eq("enabled", true);
  if (printerError) throw printerError;

  const printers = printerRows as unknown as EnabledPrinterDestRow[];
  const hasAll = printers.some((p) => p.destination === "all");
  const covered = new Set(printers.map((p) => p.destination));

  const used = new Set<"cocina" | "barra">();
  for (const row of catRows as unknown as CategoryDestinationRow[]) {
    if (row.destination === "cocina" || row.destination === "barra") used.add(row.destination);
  }

  return [...used].filter((dest) => !hasAll && !covered.has(dest));
}
```

Exportar en `packages/db/src/index.ts`:
```ts
export { destinationsMissingPrinter } from "./printer-coverage.js";
```

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `pnpm test:integration printer-coverage && pnpm typecheck`
Expected: PASS (los 4 casos).

- [ ] **Step 5: Banner en el panel** — en `apps/web/app/admin/impresoras/page.tsx`, importar y usar `destinationsMissingPrinter`. Tras resolver la sesión, calcular los destinos sin cubrir y renderizar un banner si los hay. Añadir al import de `@suarex/db` la función, y en el cuerpo:

```tsx
  const missing = await destinationsMissingPrinter(session.tenantId);
```
y en el JSX, tras el `<h1>`, antes de la lista de impresoras:
```tsx
      {missing.length > 0 ? (
        <p role="alert" data-testid="printer-warning">
          ⚠ No hay impresora habilitada para: {missing.join(", ")}. Los tickets de{" "}
          {missing.length === 1 ? "ese destino" : "esos destinos"} no se imprimen hasta que
          añadas una impresora habilitada.
        </p>
      ) : null}
```
(Usa el nombre real de la variable de sesión que ya tiene `page.tsx` — sigue el patrón de `dispositivos/page.tsx`: `const session = await requireManager();`.)

- [ ] **Step 6: Verificar build + typecheck + lint**

Run: `pnpm typecheck && pnpm lint && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/printer-coverage.ts packages/db/src/index.ts apps/web/app/admin/impresoras/page.tsx tests/integration/printer-coverage.test.ts
git commit -m "feat(admin): warn when a used destination has no enabled printer (was silent drop)"
```

---

## Verificación final de fase

- [ ] **Suite completa desde limpio:**

Run:
```bash
pnpm db:reset && pnpm db:env
pnpm typecheck && pnpm lint
pnpm test
pnpm test:integration
```
Expected: todo verde, cero skips. Registrar conteos en el ledger (`.superpowers/sdd/progress.md`).

- [ ] **Revisión de fase (opus)** vía superpowers:requesting-code-review sobre todo el diff de `feat/agente-c2a`, foco en: (1) que el agente jamás use el service role (estructural); (2) at-least-once sin perder ni duplicar de más (marca por impresora); (3) que `device_heartbeat`/`reserve_printed_self` no puedan tocar otro tenant; (4) que el rate-limit sea fail-closed y no rompa el oráculo uniforme 404; (5) que `resetDevice` revoque de verdad lo revocable y el límite JWT-stateless esté documentado con honestidad; (6) que la extracción de `selectUnprintedOrders` no cambie el comportamiento de la ruta service-role.

---

## Self-Review del plan (hecho)

**1. Cobertura del spec:**
- Núcleo del agente (bucle sondeo→render→entregar→marcar, at-least-once) → Tasks 2+3. ✅
- Lectura por JWT reutilizando la función pura (sin RPC nueva) → Tasks 1+2. ✅
- Heartbeat → Task 4. ✅
- Rate-limit del pairing (Postgres durable, 429) → Task 5. ✅
- Reset de dispositivo (deleteUser + desemparejar + nuevo código, límite JWT honesto) → Task 6. ✅
- Aviso de impresora mal configurada → Task 7. ✅
- Device nunca usa service role → estructural en Tasks 2/3, verificado en la revisión de fase. ✅

**2. Placeholders:** ninguno — todo el código está escrito. Los `Run:` usan el nombre de fichero como filtro de `pnpm test:integration`; si el runner difiere, es el equivalente directo.

**3. Consistencia de tipos:** `selectUnprintedOrders`/`PaidOrderRow`/`EnabledPrinterRow` (Task 1) ↔ consumidos en Task 2. `PrintableOrder` reusado tal cual. `AgentCredentials`/`createDeviceClient`/`unprintedPaidOrdersForDevice` (Task 2) ↔ `runAgentTick`/`runAgent` (Task 3). `reserve_printed_self`/`device_heartbeat` firmas SQL ↔ llamadas `client.rpc(...)`. `resetDevice` retorno `{pairingCode, expiresAt}` ↔ `resetDeviceAction` ↔ `PairingState` del `DeviceRow`. `check_pair_rate_limit(p_ip, p_window_seconds, p_max)` ↔ `pairRateLimitRpc` ↔ `checkPairRateLimit`.

**Riesgos anotados:** las Tasks 4 y 5 hacen `pnpm db:reset` (borra datos locales), lo cual es esperado y local-only. El test de reset (Task 6) usa `pairDevice` real (crea cuentas Auth); su limpieza va por `deleteTenantFixture` (cascada) + borrado explícito de huérfanos. El helper `signInAs(tenantId, "device")` (Task 2) no crea fila en `devices` — suficiente para el camino de LECTURA (que lee `orders`/`printers`, no la propia fila); las Tasks 3/4 sí siembran una fila `devices` enlazada porque el heartbeat la necesita.
