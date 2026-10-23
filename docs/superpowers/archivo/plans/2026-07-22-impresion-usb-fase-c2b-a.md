# Impresión USB — Fase C2b-a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la plomería de impresión USB —adaptador USB en `@suarex/printing` con un *sink* de bytes inyectable, lectura del agente de sus propias impresoras USB acotadas por `device_id`, y alta/edición de impresoras USB desde el panel— toda verificable en local sin hardware, con un sink falso.

**Architecture:** `printToPrinter` renderiza una vez y despacha la entrega por `config.adapter` (TCP existente vs USB nuevo). La entrega USB llama a un sink registrado en runtime (`registerUsbRawSink`); el sink por defecto falla limpio, un test registra uno falso, y la cáscara Electron registrará el real (winspool) en C2b-b. El agente construye una `PrinterConfig` USB y llama a `printToPrinter` sin saber nada del sink. Cero migraciones.

**Tech Stack:** TypeScript ESM (Node ≥22.12), Vitest (unit en `@suarex/printing`, integración en `tests/integration`), Playwright (e2e admin), `@suarex/printing`/`@suarex/agent`/`@suarex/db`, Next 16 Server Actions, Biome.

## Global Constraints

- **Prohibido tocar los repos/proyectos Supabase en producción.** Todo se demuestra en local con sink USB falso.
- **El agente/device NUNCA tiene el service role.** El sink USB real (winspool) NO se filtra al agente ni a la DB ni a los tests: vive en un hueco registrable de `@suarex/printing` que C2b-b rellena. El agente construye una config USB y llama a `printToPrinter`; no importa ni toca el sink.
- **El device NUNCA escribe config de impresoras.** El `printerName` lo teclea el `owner`/`admin` en el panel (Server Action `managerAction`, `tenantId` de sesión). La RLS de `printers` (escritura owner/admin) se conserva intacta.
- **Acotado USB por `device_id`:** el agente solo imprime una impresora USB si `printers.device_id` es su propio dispositivo. Las de red se siguen acotando por local (`venue_id`), y para ellas `device_id` se ignora.
- **`connection` USB:** `{ type: "usb", printerName }` — `printerName` es el nombre de la impresora tal como aparece en Windows. `deviceKey` para USB es `usb::${printerName}`.
- **Cero migraciones:** `printers.device_id`/`os`/`app_version` ya existen, `connection` es jsonb libre, `devices_select_own`/`printers_select` ya permiten al device leer lo necesario.
- **Semántica intacta:** entregar → marcar (at-least-once), marca por impresora vía `reserve_printed_self`. Textos de UI en castellano. TDD; commits frecuentes.

## Comandos del repo

- Tests de integración (stack local): `pnpm test:integration <filtro>`.
- Unit de un paquete: `pnpm --filter @suarex/printing test` (o `pnpm test` para todos vía turbo).
- Typecheck: `pnpm typecheck`. Lint: `pnpm lint`. Build web: `pnpm --filter web build`.
- e2e: `pnpm seed:staff && pnpm test:e2e <filtro>`.

---

## Task 1: Adaptador USB en `@suarex/printing` (dispatch + sink registrable)

**Files:**
- Modify: `packages/printing/src/adapters/types.ts`
- Create: `packages/printing/src/usb-sink.ts`
- Modify: `packages/printing/src/print-order.ts`
- Modify: `packages/printing/src/index.ts`
- Test: `packages/printing/src/usb-adapter.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts — PrinterConfig pasa a unión discriminada por `adapter`
  export type PrinterConfig =
    | { adapter: "escpos-tcp"; id: string; label: string; destination: "cocina" | "barra" | "all"; host: string; port: number }
    | { adapter: "escpos-usb"; id: string; label: string; destination: "cocina" | "barra" | "all"; printerName: string };
  export type PrintResult = { id: string; label: string; ok: boolean; reason?: string };
  // usb-sink.ts
  export type UsbRawSink = (buffer: Buffer, printerName: string) => Promise<void>;
  export function registerUsbRawSink(sink: UsbRawSink | null): void; // null restaura el default
  // print-order.ts — deviceKey ahora despacha por adapter; printToPrinter despacha la entrega
  ```
  `deviceKey({adapter:"escpos-usb", printerName})` → `usb::${printerName}`. `printToPrinter(lines, usbConfig)` con un sink registrado que resuelve → `ok:true`; sink que lanza → `ok:false` con `reason`; sin sink registrado → el default lanza → `ok:false`.

- [ ] **Step 1: Escribir el test que falla** — `packages/printing/src/usb-adapter.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { renderEscPos } from "./render.js";
import { deviceKey, printToPrinter } from "./print-order.js";
import { registerUsbRawSink } from "./usb-sink.js";
import type { PrinterConfig } from "./adapters/types.js";

const lines = [
  { kind: "text" as const, text: "COCINA", align: "center" as const, bold: true },
  { kind: "text" as const, text: "1x  Tosta", align: "left" as const },
  { kind: "cut" as const },
];

const usbConfig: PrinterConfig = {
  adapter: "escpos-usb",
  id: "p1",
  label: "Cocina",
  destination: "cocina",
  printerName: "EPSON TM-T20",
};

afterEach(() => {
  registerUsbRawSink(null); // restaura el default entre tests
});

describe("printToPrinter (escpos-usb)", () => {
  it("entrega al sink el Buffer exacto de renderEscPos, para el printerName correcto", async () => {
    const received: { buffer: Buffer; printerName: string }[] = [];
    registerUsbRawSink(async (buffer, printerName) => {
      received.push({ buffer, printerName });
    });

    const result = await printToPrinter(lines, usbConfig);

    expect(result.ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]?.printerName).toBe("EPSON TM-T20");
    expect(received[0]?.buffer.equals(renderEscPos(lines))).toBe(true);
  });

  it("un sink que lanza produce ok:false con reason", async () => {
    registerUsbRawSink(async () => {
      throw new Error("spooler no disponible");
    });
    const result = await printToPrinter(lines, usbConfig);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("sin sink registrado, el default falla limpio (ok:false)", async () => {
    // registerUsbRawSink no se llamó (el afterEach del test anterior lo restauró a default).
    const result = await printToPrinter(lines, usbConfig);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("deviceKey de una config USB usa el esquema usb::", () => {
    expect(deviceKey(usbConfig)).toBe("usb::EPSON TM-T20");
  });

  it("deviceKey de una config TCP sigue usando tcp::", () => {
    const tcp: PrinterConfig = {
      adapter: "escpos-tcp", id: "p2", label: "Red", destination: "cocina", host: "127.0.0.1", port: 9100,
    };
    expect(deviceKey(tcp)).toBe("tcp::127.0.0.1:9100");
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm --filter @suarex/printing test`
Expected: FAIL (`usb-sink.js` no existe; `PrinterConfig` no admite `adapter:"escpos-usb"`; `deviceKey` no despacha).

- [ ] **Step 3: Convertir `PrinterConfig` en unión** — `packages/printing/src/adapters/types.ts` completo:

```ts
type PrinterBase = {
  id: string;
  label: string;
  destination: "cocina" | "barra" | "all";
};

export type PrinterConfig =
  | (PrinterBase & { adapter: "escpos-tcp"; host: string; port: number })
  | (PrinterBase & { adapter: "escpos-usb"; printerName: string });

export type PrintResult = { id: string; label: string; ok: boolean; reason?: string };
```

- [ ] **Step 4: Crear el hueco del sink** — `packages/printing/src/usb-sink.ts`:

```ts
/**
 * Hueco registrable de la entrega USB. `@suarex/printing` NO sabe cómo hablar con el
 * spooler de Windows (winspool): eso es un binding nativo, específico de Windows y de
 * Electron, que se registra en runtime desde la cáscara (fase C2b-b) o desde un test (con
 * un sink falso). Aislarlo aquí es lo que mantiene al agente, a la base de datos y a los
 * tests ignorantes del mecanismo real -- el agente construye una `PrinterConfig` USB y
 * llama a `printToPrinter`, y esta capa resuelve la entrega.
 *
 * El sink por defecto LANZA: en un host sin sink registrado (o no-Windows) la entrega USB
 * falla limpio, `printToPrinter` lo mapea a `ok:false`, y el pedido se reintenta sin
 * marcarse -- exactamente el mismo contrato que un fallo de entrega TCP.
 */
export type UsbRawSink = (buffer: Buffer, printerName: string) => Promise<void>;

const defaultSink: UsbRawSink = async () => {
  throw new Error(
    "impresión USB no disponible: no hay sink registrado (registerUsbRawSink) en esta plataforma",
  );
};

let currentSink: UsbRawSink = defaultSink;

/** Registra el sink de entrega USB. `null` restaura el sink por defecto (que lanza). */
export function registerUsbRawSink(sink: UsbRawSink | null): void {
  currentSink = sink ?? defaultSink;
}

/** Entrega interna: delega en el sink actual. No captura el error -- lo propaga a
 * `deliverUsb`/`printToPrinter`, que lo mapean a `ok:false`. */
export function usbRawSink(buffer: Buffer, printerName: string): Promise<void> {
  return currentSink(buffer, printerName);
}
```

- [ ] **Step 5: Despachar en `print-order.ts`** — cambios exactos:

Añadir el import (tras los existentes):
```ts
import { usbRawSink } from "./usb-sink.js";
```

Sustituir `deviceKey` por su versión con dispatch:
```ts
export function deviceKey(config: PrinterConfig): string {
  return config.adapter === "escpos-usb"
    ? `usb::${config.printerName}`
    : `tcp::${config.host}:${config.port}`;
}
```

Añadir la entrega USB (junto a `deliverOnce`, p. ej. justo después de ella):
```ts
/**
 * Entrega el buffer ya renderizado a una impresora USB, a través del sink registrado
 * (winspool RAW en producción, un falso en los tests). Igual que `deliverOnce`, resuelve si
 * la entrega tuvo éxito y lanza si falló -- `printToPrinter` mapea ambos a `PrintResult`.
 * Aquí NO hay socket: los mismos bytes ESC/POS que iría por TCP se entregan al spooler.
 */
function deliverUsb(buffer: Buffer, printerName: string): Promise<void> {
  return usbRawSink(buffer, printerName);
}
```

Sustituir el cuerpo del bucle de `printToPrinter` para despachar por adapter. Reemplazar la línea `await deliverOnce(buffer, config.host, config.port);` por:
```ts
      if (config.adapter === "escpos-usb") {
        await deliverUsb(buffer, config.printerName);
      } else {
        await deliverOnce(buffer, config.host, config.port);
      }
```
(El resto de `printToPrinter` —render una vez, bucle de reintentos, `PrintResult`— queda igual; el dispatch va dentro del `try`, así que el reintento cubre ambos caminos por igual.)

- [ ] **Step 6: Exportar** en `packages/printing/src/index.ts` (añadir):
```ts
export type { UsbRawSink } from "./usb-sink.js";
export { registerUsbRawSink } from "./usb-sink.js";
```

- [ ] **Step 7: Ejecutar tests + typecheck + lint**

Run: `pnpm --filter @suarex/printing test && pnpm typecheck && pnpm lint`
Expected: PASS (5 casos USB nuevos + los de `escpos-tcp.test.ts` sin cambios). Nota: `escpos-tcp.test.ts` construye configs con `adapter:"escpos-tcp"` + host/port, que siguen encajando en la unión — no debería requerir cambios; si `noUncheckedIndexedAccess` se queja de algún acceso, es en el test nuevo, no en el de TCP.

- [ ] **Step 8: Commit**

```bash
git add packages/printing/src/adapters/types.ts packages/printing/src/usb-sink.ts packages/printing/src/print-order.ts packages/printing/src/index.ts packages/printing/src/usb-adapter.test.ts
git commit -m "feat(printing): USB adapter dispatch + registrable raw sink (escpos-usb)"
```

---

## Task 2: Agente — impresoras USB acotadas por dispositivo

**Files:**
- Modify: `packages/agent/src/run-agent.ts`
- Test: `tests/integration/agent-usb.test.ts`

**Interfaces:**
- Consumes: `PrinterConfig` union (Task 1), `registerUsbRawSink` (Task 1, en el test); `deviceKey`/`enqueueByDevice`/`printToPrinter` (`@suarex/printing`).
- Produces: `runAgentTick` ahora imprime impresoras de red (acotadas por venue, como antes) **y** USB (acotadas por `device_id === ` el propio device). Sin cambio de firma pública.

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/agent-usb.test.ts`:

```ts
import { registerUsbRawSink } from "@suarex/printing";
import { createDeviceClient, runAgentTick } from "@suarex/agent";
import { afterEach, describe, expect, it } from "vitest";
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

type UsbCapture = { buffer: Buffer; printerName: string };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  registerUsbRawSink(null);
  for (const c of cleanups.splice(0)) await c();
});

/** Siembra un tenant con un venue, un pedido pagado de cocina, un device (Auth + membership
 * + fila devices enlazada), y devuelve credenciales + ids. */
async function seed(): Promise<{
  tenant: TenantFixture;
  venueId: string;
  orderId: string;
  deviceId: string;
  email: string;
  password: string;
}> {
  const tenant = await createTenantFixture(`usb-${nonce()}`);
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
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: `m-${nonce()}` })
    .select("id").single();
  const { createPendingOrder } = await import("@suarex/db");
  const order = await createPendingOrder({
    tenantId: tenant.tenantId, venueId, tableId: table?.id as string,
    lines: [{ productId: prod?.id as string, quantity: 1, extraIds: [], notes: null }], taxRate: 0.1,
  });
  await admin.from("orders").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", order.orderId);

  const email = `usb-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const deviceUserId = user?.user?.id as string;
  await admin.from("memberships").insert({ user_id: deviceUserId, tenant_id: tenant.tenantId, role: "device" });
  const { data: device } = await admin.from("devices")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Agente", auth_user_id: deviceUserId, paired_at: new Date().toISOString() })
    .select("id").single();

  cleanups.push(async () => {
    await deleteMembershipFixtureUser(deviceUserId);
    await deleteTenantFixture(tenant);
  });
  return { tenant, venueId, orderId: order.orderId, deviceId: device?.id as string, email, password };
}

describe("runAgentTick — impresoras USB", () => {
  it("imprime la impresora USB atada a SU dispositivo (bytes al sink) y marca el pedido", async () => {
    const s = await seed();
    await admin.from("printers").insert({
      tenant_id: s.tenant.tenantId, venue_id: s.venueId, device_id: s.deviceId,
      name: "USB Cocina", connection: { type: "usb", printerName: "EPSON TM-T20" }, destination: "cocina", enabled: true,
    });

    const captures: UsbCapture[] = [];
    registerUsbRawSink(async (buffer, printerName) => { captures.push({ buffer, printerName }); });

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(), anonKey: anonKeyForTest(), email: s.email, password: s.password,
    });
    const r = await runAgentTick(client);

    expect(r.printed).toBe(1);
    expect(captures).toHaveLength(1);
    expect(captures[0]?.printerName).toBe("EPSON TM-T20");
    expect(captures[0]?.buffer.toString("latin1")).toContain("Paella");
    const { data: row } = await admin.from("orders").select("printed_at").eq("id", s.orderId).single();
    expect(row?.printed_at).not.toBeNull();
  });

  it("NO imprime una impresora USB atada a OTRO dispositivo", async () => {
    const s = await seed();
    // Un segundo device del mismo tenant, y la USB atada a ESE otro device.
    const { data: otherUser } = await admin.auth.admin.createUser({
      email: `usb-other-${nonce()}@devices.local`, password: "pw", email_confirm: true,
    });
    const otherUserId = otherUser?.user?.id as string;
    cleanups.push(async () => { await deleteMembershipFixtureUser(otherUserId); });
    await admin.from("memberships").insert({ user_id: otherUserId, tenant_id: s.tenant.tenantId, role: "device" });
    const { data: otherDevice } = await admin.from("devices")
      .insert({ tenant_id: s.tenant.tenantId, venue_id: s.venueId, name: "Otro", auth_user_id: otherUserId })
      .select("id").single();
    await admin.from("printers").insert({
      tenant_id: s.tenant.tenantId, venue_id: s.venueId, device_id: otherDevice?.id,
      name: "USB del otro", connection: { type: "usb", printerName: "OTRA" }, destination: "cocina", enabled: true,
    });

    const captures: UsbCapture[] = [];
    registerUsbRawSink(async (buffer, printerName) => { captures.push({ buffer, printerName }); });

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(), anonKey: anonKeyForTest(), email: s.email, password: s.password,
    });
    const r = await runAgentTick(client);

    expect(captures).toHaveLength(0); // este agente no reclama la USB de otro device
    expect(r.printed).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration agent-usb`
Expected: FAIL — el agente hoy ignora las USB (`networkPrinters` filtra `type === "network"`), así que el primer test imprime 0 y el sink no recibe nada.

- [ ] **Step 3: Refactorizar `runAgentTick`** en `packages/agent/src/run-agent.ts` para resolver red + USB en una lista unificada. Sustituir el tipo `PrinterRow` y la función `networkPrinters` por:

```ts
type PrinterRowDb = {
  id: string;
  venue_id: string;
  device_id: string | null;
  destination: "cocina" | "barra" | "all";
  connection: { type?: string; host?: string; port?: number; printerName?: string };
};

type ResolvedPrinter = {
  id: string;
  venueId: string;
  destination: "cocina" | "barra" | "all";
  config: PrinterConfig;
};

/** Impresora id del PROPIO dispositivo del agente, leída con su JWT (`devices_select_own`
 * devuelve solo la fila cuyo `auth_user_id = auth.uid()`). `null` si no hay fila (p. ej. un
 * device sembrado sin fila en `devices`): entonces no se reclama ninguna USB. */
async function ownDeviceId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.from("devices").select("id").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Impresoras habilitadas que este agente puede imprimir, con su `PrinterConfig` ya
 * construida por tipo:
 *   - RED (`connection.type === "network"`): cualquier agente del tenant la alcanza; el
 *     acotado por local (`venue_id`) lo aplica el bucle de impresión (igual que antes).
 *   - USB (`connection.type === "usb"`): SOLO si `device_id` es el propio dispositivo -- una
 *     impresora USB está físicamente en ESTE PC, así que ningún otro agente debe reclamarla.
 * Un tipo desconocido, o una USB de otro device, se ignora.
 */
async function resolvePrinters(client: SupabaseClient): Promise<ResolvedPrinter[]> {
  const deviceId = await ownDeviceId(client);
  const { data, error } = await client
    .from("printers")
    .select("id, venue_id, device_id, destination, connection")
    .eq("enabled", true);
  if (error) throw error;

  const resolved: ResolvedPrinter[] = [];
  for (const p of data as unknown as PrinterRowDb[]) {
    const conn = p.connection ?? {};
    if (conn.type === "network") {
      resolved.push({
        id: p.id, venueId: p.venue_id, destination: p.destination,
        config: {
          adapter: "escpos-tcp", id: p.id, label: p.id, destination: p.destination,
          host: conn.host as string, port: conn.port as number,
        },
      });
    } else if (conn.type === "usb" && deviceId !== null && p.device_id === deviceId) {
      resolved.push({
        id: p.id, venueId: p.venue_id, destination: p.destination,
        config: {
          adapter: "escpos-usb", id: p.id, label: p.id, destination: p.destination,
          printerName: conn.printerName as string,
        },
      });
    }
  }
  return resolved;
}
```

Y en `runAgentTick`, sustituir la llamada a `networkPrinters(client)` por `resolvePrinters(client)`, y adaptar el bucle a `ResolvedPrinter` (la `config` ya viene construida). El bloque `const [orders, printers, branding] = await Promise.all([...])` pasa a usar `resolvePrinters(client)`, y dentro del bucle interno se sustituye la construcción inline de `config` por el uso de `printer.config`:

```ts
  const [orders, printers, branding] = await Promise.all([
    unprintedPaidOrdersForDevice(client),
    resolvePrinters(client),
    ticketBranding(client),
  ]);

  let printed = 0;
  let failed = 0;

  for (const order of orders) {
    const ticketOrder = toTicketOrder(order);
    const neededDestinations = new Set(order.items.map((i) => i.destination));
    for (const printer of printers) {
      // Acotado por local (venue) para TODAS las impresoras (red y USB): un pedido solo se
      // imprime en las impresoras de su propio local (ver Finding 1 de C2a).
      if (printer.venueId !== order.venueId) continue;
      const dest = printer.destination;
      const applies = dest === "all" || neededDestinations.has(dest);
      if (!applies) continue;
      if (Object.hasOwn(order.printedTargets, printer.id)) continue;

      const lines = buildTicketLines(ticketOrder, branding, dest);
      const result = await enqueueByDevice(deviceKey(printer.config), () =>
        printToPrinter(lines, printer.config),
      );
      if (result.ok) {
        const { error } = await client.rpc("reserve_printed_self", {
          p_order_id: order.id,
          p_printer_id: printer.id,
          p_at: new Date().toISOString(),
        });
        if (error) {
          console.error("[agent] fallo al marcar impreso:", error);
          failed += 1;
          continue;
        }
        printed += 1;
      } else {
        failed += 1;
      }
    }
  }
```
(El heartbeat al final del tick y `runAgent` quedan sin cambios. `PrinterConfig` ya se importa. Elimina el import/uso de la vieja `networkPrinters` y su tipo `PrinterRow`.)

- [ ] **Step 4: Ejecutar el test USB + la regresión del bucle de red**

Run: `pnpm test:integration agent-usb && pnpm test:integration agent-loop && pnpm typecheck && pnpm lint`
Expected: PASS (los 2 casos USB + los 3 de `agent-loop` de red sin cambios).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/run-agent.ts tests/integration/agent-usb.test.ts
git commit -m "feat(agent): print own USB printers scoped by device_id (unified network+USB loop)"
```

---

## Task 3: Admin (repo) — conexión USB + `buildUsbConnection`

**Files:**
- Modify: `packages/db/src/admin-printers.ts`
- Modify: `apps/web/app/admin/impresoras/actions.ts`
- Test: `tests/integration/admin-printers-usb.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PrinterConnection = { type: "network"; host: string; port: number } | { type: "usb"; printerName: string };
  export type PrinterConnectionInput = { type: "network"; host: string; port: number } | { type: "usb"; printerName: string };
  export function buildUsbConnection(printerName: string): PrinterConnection;
  // CreatePrinterInput/UpdatePrinterInput pasan a llevar `connection: PrinterConnectionInput` en vez de host/port sueltos
  ```
- Consumes: `tenantScoped` (existente).
- Esta tarea cambia la forma de `CreatePrinterInput`/`UpdatePrinterInput` (de `host`/`port` sueltos a un descriptor `connection`), así que ACTUALIZA también las Server Actions (`createPrinterAction`/`updatePrinterAction`) para construir un descriptor `{ type: "network", host, port }` a partir de los campos actuales del formulario. La UI (PrinterForm) NO cambia en esta tarea: sigue siendo solo red; la opción USB en el formulario llega en la Task 4.

- [ ] **Step 1: Escribir el test que falla** — `tests/integration/admin-printers-usb.test.ts`:

```ts
import { buildUsbConnection, createPrinter, listPrinters } from "@suarex/db";
import { afterEach, describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

const fixtures: TenantFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await deleteTenantFixture(f);
});

async function seedVenueAndDevice(tenant: TenantFixture): Promise<{ venueId: string; deviceId: string }> {
  const { data: venue } = await admin.from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id").single();
  const venueId = venue?.id as string;
  const { data: device } = await admin.from("devices")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "PC" })
    .select("id").single();
  return { venueId, deviceId: device?.id as string };
}

describe("buildUsbConnection", () => {
  it("construye una conexión USB válida", () => {
    expect(buildUsbConnection("EPSON TM-T20")).toEqual({ type: "usb", printerName: "EPSON TM-T20" });
  });
  it("rechaza un printerName vacío", () => {
    expect(() => buildUsbConnection("   ")).toThrow(/printerName|vac/i);
  });
});

describe("createPrinter con conexión USB", () => {
  it("escribe una fila con connection {type:usb, printerName} y su device_id", async () => {
    const tenant = await createTenantFixture(`ap-usb-${nonce()}`);
    fixtures.push(tenant);
    const { venueId, deviceId } = await seedVenueAndDevice(tenant);

    const { id } = await createPrinter(tenant.tenantId, {
      venueId,
      name: "USB Cocina",
      connection: { type: "usb", printerName: "EPSON TM-T20" },
      destination: "cocina",
      deviceId,
    });

    const printers = await listPrinters(tenant.tenantId);
    const row = printers.find((p) => p.id === id);
    expect(row?.connection).toEqual({ type: "usb", printerName: "EPSON TM-T20" });
    expect(row?.deviceId).toBe(deviceId);
  });

  it("sigue escribiendo una conexión de red cuando el tipo es network", async () => {
    const tenant = await createTenantFixture(`ap-net-${nonce()}`);
    fixtures.push(tenant);
    const { venueId } = await seedVenueAndDevice(tenant);
    const { id } = await createPrinter(tenant.tenantId, {
      venueId, name: "Red", connection: { type: "network", host: "127.0.0.1", port: 9100 }, destination: "cocina",
    });
    const row = (await listPrinters(tenant.tenantId)).find((p) => p.id === id);
    expect(row?.connection).toEqual({ type: "network", host: "127.0.0.1", port: 9100 });
  });

  it("atar una impresora USB a un device de OTRO tenant lo rechaza el trigger", async () => {
    const a = await createTenantFixture(`ap-a-${nonce()}`);
    const b = await createTenantFixture(`ap-b-${nonce()}`);
    fixtures.push(a, b);
    const va = await seedVenueAndDevice(a);
    const vb = await seedVenueAndDevice(b);
    await expect(
      createPrinter(a.tenantId, {
        venueId: va.venueId, name: "X", connection: { type: "usb", printerName: "P" }, destination: "cocina",
        deviceId: vb.deviceId, // device del tenant B
      }),
    ).rejects.toThrow(/cross-tenant/i);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration admin-printers-usb`
Expected: FAIL (`buildUsbConnection` no existe; `CreatePrinterInput` no acepta `connection`).

- [ ] **Step 3: Modificar `packages/db/src/admin-printers.ts`.** Cambios:

`PrinterConnection` pasa a unión:
```ts
export type PrinterConnection =
  | { type: "network"; host: string; port: number }
  | { type: "usb"; printerName: string };

/** Descriptor de conexión que recibe el repositorio (lo compone la Server Action a partir
 * del formulario). Misma forma que `PrinterConnection`; se valida en `buildConnection`. */
export type PrinterConnectionInput = PrinterConnection;
```

`CreatePrinterInput`/`UpdatePrinterInput` cambian `host`/`port` sueltos por `connection`:
```ts
export type CreatePrinterInput = {
  venueId: string;
  name: string;
  connection: PrinterConnectionInput;
  destination?: PrinterDestination;
  deviceId?: string;
  isDefault?: boolean;
  enabled?: boolean;
};

export type UpdatePrinterInput = Partial<{
  venueId: string;
  name: string;
  connection: PrinterConnectionInput;
  destination: PrinterDestination;
  deviceId: string | null;
  isDefault: boolean;
  enabled: boolean;
}>;
```

Añadir `buildUsbConnection` + un dispatcher `buildConnection` (junto a `buildNetworkConnection`, que se conserva tal cual):
```ts
/** Validación de la conexión USB: `printerName` no vacío tras `trim()` (un nombre en blanco
 * no identifica ninguna impresora de Windows). Análogo de `buildNetworkConnection`. */
export function buildUsbConnection(printerName: string): PrinterConnection {
  if (printerName.trim() === "") {
    throw new Error("printerName inválido: no puede estar vacío");
  }
  return { type: "usb", printerName };
}

/** Despacha por tipo al validador correspondiente. Un tipo desconocido se rechaza. */
function buildConnection(input: PrinterConnectionInput): PrinterConnection {
  if (input.type === "network") return buildNetworkConnection(input.host, input.port);
  if (input.type === "usb") return buildUsbConnection(input.printerName);
  throw new Error(`tipo de conexión no soportado: ${(input as { type: string }).type}`);
}
```

`createPrinter`: sustituir `const connection = buildNetworkConnection(input.host, input.port);` por:
```ts
  const connection = buildConnection(input.connection);
```

`updatePrinter`: sustituir el bloque `if (patch.host !== undefined || patch.port !== undefined) { ... }` por:
```ts
  if (patch.connection !== undefined) {
    values.connection = buildConnection(patch.connection);
  }
```

Exportar `buildUsbConnection` y el tipo `PrinterConnectionInput` en `packages/db/src/index.ts` (en el bloque de `./admin-printers.js`):
```ts
export type {
  CreatePrinterInput,
  PrinterConnection,
  PrinterConnectionInput,
  PrinterDestination,
  PrinterRow,
  UpdatePrinterInput,
} from "./admin-printers.js";
export {
  buildUsbConnection,
  createPrinter,
  deletePrinter,
  listPrinters,
  updatePrinter,
} from "./admin-printers.js";
```
(Ajusta el bloque existente para añadir `PrinterConnectionInput` al `export type` y `buildUsbConnection` al `export`; conserva los nombres ya exportados.)

- [ ] **Step 4: Actualizar las Server Actions** — `apps/web/app/admin/impresoras/actions.ts`. Como `CreatePrinterInput`/`UpdatePrinterInput` ya no llevan `host`/`port` sueltos, las actions construyen un descriptor de RED (la UI sigue siendo solo red en esta tarea). En `createPrinterAction`, sustituir el bloque `host`/`port`:
```ts
  const host = requiredString(formData, "host");
  const port = Number(requiredString(formData, "port"));

  await createPrinter(session.tenantId, {
    venueId,
    name,
    connection: { type: "network", host, port },
    destination: parseDestination(formData),
    deviceId: optionalString(formData, "device_id"),
    isDefault: parseOptionalBoolean(formData, "is_default"),
    enabled: parseOptionalBoolean(formData, "enabled"),
  });
```
En `updatePrinterAction`, sustituir el `host`/`port` sueltos por un `connection` condicional (solo si ambos vienen, misma regla que antes):
```ts
  const host = optionalString(formData, "host");
  const port = parseOptionalInt(formData, "port");

  await updatePrinter(session.tenantId, printerId, {
    venueId: optionalString(formData, "venue_id"),
    name: optionalString(formData, "name"),
    connection: host !== undefined && port !== undefined ? { type: "network", host, port } : undefined,
    destination: parseDestination(formData),
    deviceId: optionalString(formData, "device_id"),
    isDefault: parseOptionalBoolean(formData, "is_default"),
    enabled: parseOptionalBoolean(formData, "enabled"),
  });
```
(La validación "host y port juntos" que antes vivía en `updatePrinter` ahora es implícita: solo se construye el descriptor de red si ambos están presentes. Si solo viene uno, `connection` es `undefined` y no se toca la conexión — mismo efecto neto sin lanzar. Esto es un cambio de comportamiento menor y aceptable: el formulario de red siempre manda ambos.)

- [ ] **Step 5: Ejecutar tests + regresión e2e de red + typecheck + lint**

Run: `pnpm test:integration admin-printers-usb && pnpm typecheck && pnpm lint`
Expected: PASS (los 4 casos del repo). El e2e de red (`admin-d2.spec.ts`) se valida en la Task 4 tras tocar el formulario; aquí basta con typecheck/lint/tests de integración.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/admin-printers.ts packages/db/src/index.ts apps/web/app/admin/impresoras/actions.ts tests/integration/admin-printers-usb.test.ts
git commit -m "feat(db): USB printer connection (buildUsbConnection + connection descriptor input)"
```

---

## Task 4: Admin (UI) — formulario con selector Red/USB

**Files:**
- Modify: `apps/web/app/admin/impresoras/PrinterForm.tsx`
- Modify: `apps/web/app/admin/impresoras/actions.ts`
- Test: `tests/e2e/admin-c2b.spec.ts`

**Interfaces:**
- Consumes: `createPrinterAction` (Task 3). El formulario añade un selector `connection_type` (network/usb) y un campo `printer_name`; la action lee `connection_type` y construye el descriptor correcto.

- [ ] **Step 1: Añadir los campos al formulario** — `apps/web/app/admin/impresoras/PrinterForm.tsx`. Es un componente de servidor (sin JS de cliente), así que los campos de red y el de USB conviven siempre visibles; el owner elige el tipo con un `<select>` y rellena los campos del tipo elegido. Añadir tras el `<input hidden venue_id>`:

```tsx
      <label htmlFor="printer-connection-type">Tipo de conexión</label>
      <select id="printer-connection-type" name="connection_type" defaultValue="network">
        <option value="network">Red (IP:puerto)</option>
        <option value="usb">USB (impresora de Windows)</option>
      </select>
```
Y tras los campos `host`/`port` (que quedan para el tipo Red), añadir el campo USB:
```tsx
      <label htmlFor="printer-printername">Nombre de impresora Windows (solo USB)</label>
      <input id="printer-printername" name="printer_name" type="text" />
```
(Los campos `host`/`port` dejan de ser `required` en el HTML, porque para USB no aplican; la validación real la hace la action/repo según el tipo. Quita `required` de `host` y `port`.)

- [ ] **Step 2: Despachar por tipo en la action** — `apps/web/app/admin/impresoras/actions.ts`, en `createPrinterAction`, sustituir la construcción del `connection` por un dispatch según `connection_type`:

```ts
  const connectionType = optionalString(formData, "connection_type") ?? "network";
  const connection =
    connectionType === "usb"
      ? { type: "usb" as const, printerName: requiredString(formData, "printer_name") }
      : { type: "network" as const, host: requiredString(formData, "host"), port: Number(requiredString(formData, "port")) };

  await createPrinter(session.tenantId, {
    venueId,
    name,
    connection,
    destination: parseDestination(formData),
    deviceId: optionalString(formData, "device_id"),
    isDefault: parseOptionalBoolean(formData, "is_default"),
    enabled: parseOptionalBoolean(formData, "enabled"),
  });
```
(`name`/`venueId` se leen antes, igual que ahora. La validación de `printerName` vacío la hace `buildUsbConnection` en el repo; `requiredString` ya rechaza un `printer_name` ausente en el camino USB.)

- [ ] **Step 3: Escribir el e2e** — `tests/e2e/admin-c2b.spec.ts`. Da de alta una impresora USB desde el panel y comprueba que aparece con su tipo; usa el patrón de `admin-d2.spec.ts` (login owner, `afterEach` que borra por id vía helper). Reutiliza el helper de borrado `deletePrinterForTest` de `tests/e2e/helpers/admin-d2-db.ts`.

```ts
import { expect, type Page, test } from "@playwright/test";
import { deletePrinterForTest } from "./helpers/admin-d2-db.js";

const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;

test.beforeAll(() => {
  expect(OWNER_PASSWORD, "Falta OWNER_SEED_PASSWORD: corre `pnpm seed:staff`.").toBeTruthy();
});

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL("http://garum.localhost:3000/staff", { timeout: 15_000 });
}

let createdPrinterId: string | undefined;
test.afterEach(async () => {
  if (createdPrinterId) {
    const id = createdPrinterId;
    createdPrinterId = undefined;
    try { await deletePrinterForTest(id); } catch (e) { console.error(`No se pudo borrar la impresora ${id}:`, e); }
  }
});

test("un owner da de alta una impresora USB", async ({ page }) => {
  await login(page, "owner@garum.local", OWNER_PASSWORD as string);
  await page.goto("http://garum.localhost:3000/admin/impresoras");
  await expect(page.locator("h1")).toHaveText("Gestión de impresoras");

  const name = `USB E2E ${Date.now()}`;
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByLabel("Tipo de conexión").selectOption("usb");
  await page.getByLabel("Nombre de impresora Windows (solo USB)").fill("EPSON TM-T20");
  await page.getByLabel("Destino").selectOption("cocina");
  await page.getByRole("button", { name: "Crear impresora" }).click();

  const row = page.getByTestId("admin-printer").filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  createdPrinterId = (await row.getAttribute("data-printer-id")) ?? undefined;
  expect(createdPrinterId).toBeTruthy();
});
```
Nota: comprueba que la fila de impresora (`impresoras/page.tsx`) tiene `data-testid="admin-printer"` y `data-printer-id` — el e2e de D2 (`admin-d2.spec.ts`) ya los usa, así que existen; si el nombre de impresora Windows se muestra en la fila, puedes añadir un `await expect(row.getByText("EPSON TM-T20")).toBeVisible();`, pero no es imprescindible.

- [ ] **Step 4: Ejecutar el e2e nuevo + el de red (regresión) + build**

Run: `pnpm seed:staff && pnpm test:e2e admin-c2b && pnpm test:e2e admin-d2 && pnpm typecheck && pnpm lint && pnpm --filter web build`
Expected: PASS (alta USB nueva + el alta de impresora de RED de `admin-d2` sigue verde, porque `connection_type` por defecto es `network` y el formulario sigue mandando host/port).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/impresoras/PrinterForm.tsx apps/web/app/admin/impresoras/actions.ts tests/e2e/admin-c2b.spec.ts
git commit -m "feat(admin): printer form connection-type selector (Red/USB) + USB printerName"
```

---

## Task 5: Aviso de impresora USB sin dispositivo

**Files:**
- Modify: `packages/db/src/printer-coverage.ts`
- Modify: `apps/web/app/admin/impresoras/page.tsx`
- Test: `tests/integration/printer-coverage.test.ts` (añadir bloque)

**Interfaces:**
- Produces:
  ```ts
  export function usbPrintersWithoutDevice(tenantId: string): Promise<{ id: string; name: string }[]>;
  ```
  Devuelve las impresoras habilitadas de tipo USB que NO tienen `device_id` asignado (ningún agente las reclama → nunca imprimen). El panel las señala, igual que un destino sin impresora.

- [ ] **Step 1: Escribir el test que falla** — añadir a `tests/integration/printer-coverage.test.ts`:

```ts
import { usbPrintersWithoutDevice } from "@suarex/db";

describe("usbPrintersWithoutDevice", () => {
  it("señala una USB habilitada sin device_id", async () => {
    const tenant = await createTenantFixture(`uwd-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "USB huérfana",
      connection: { type: "usb", printerName: "P" }, destination: "cocina", enabled: true, // sin device_id
    });
    const orphans = await usbPrintersWithoutDevice(tenant.tenantId);
    expect(orphans.map((p) => p.name)).toContain("USB huérfana");
  });

  it("no señala una USB con device_id, ni una de red sin device_id", async () => {
    const tenant = await createTenantFixture(`uwd2-${nonce()}`);
    fixtures.push(tenant);
    const venueId = await seedVenue(tenant);
    const { data: device } = await admin.from("devices")
      .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "PC" }).select("id").single();
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "USB atada", device_id: device?.id,
      connection: { type: "usb", printerName: "P" }, destination: "cocina", enabled: true,
    });
    await admin.from("printers").insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "Red sin device",
      connection: { type: "network", host: "127.0.0.1", port: 9100 }, destination: "cocina", enabled: true,
    });
    expect(await usbPrintersWithoutDevice(tenant.tenantId)).toEqual([]);
  });
});
```
(Reutiliza el helper `seedVenue` y el array `fixtures`/`afterEach` que ya existen en ese fichero de la fase C2a.)

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `pnpm test:integration printer-coverage`
Expected: FAIL (`usbPrintersWithoutDevice` no exportada).

- [ ] **Step 3: Implementar en `packages/db/src/printer-coverage.ts`** (añadir al final):

```ts
type UsbPrinterRow = {
  id: string;
  name: string;
  device_id: string | null;
  connection: { type?: string };
};

/**
 * Impresoras USB HABILITADAS sin `device_id` asignado: como el agente solo reclama una USB
 * atada a su propio dispositivo (`packages/agent/src/run-agent.ts`), una USB sin `device_id`
 * no la imprime NINGÚN agente -- sus tickets se pierden en silencio. El panel de impresoras
 * lo señala, mismo espíritu que `destinationsMissingPrinter`: hacer visible una configuración
 * que dejaría pedidos sin imprimir.
 */
export async function usbPrintersWithoutDevice(
  tenantId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await tenantScoped("printers", tenantId)
    .select("id, name, device_id, connection")
    .eq("enabled", true);
  if (error) throw error;

  return (data as unknown as UsbPrinterRow[])
    .filter((p) => p.connection?.type === "usb" && p.device_id === null)
    .map((p) => ({ id: p.id, name: p.name }));
}
```

Exportar en `packages/db/src/index.ts` (junto a `destinationsMissingPrinter`):
```ts
export { destinationsMissingPrinter, usbPrintersWithoutDevice } from "./printer-coverage.js";
```

- [ ] **Step 4: Banner en el panel** — `apps/web/app/admin/impresoras/page.tsx`. Importar `usbPrintersWithoutDevice`, calcularlo y renderizar un aviso si no está vacío. Añadir junto al cálculo de `destinationsMissingPrinter` ya existente:
```tsx
  const usbSinDispositivo = await usbPrintersWithoutDevice(session.tenantId);
```
Y en el JSX, tras el banner de destinos sin impresora:
```tsx
      {usbSinDispositivo.length > 0 ? (
        <p role="alert" data-testid="usb-no-device-warning">
          ⚠ Impresora(s) USB sin dispositivo asignado: {usbSinDispositivo.map((p) => p.name).join(", ")}.
          No imprimen hasta que las ates a un dispositivo.
        </p>
      ) : null}
```

- [ ] **Step 5: Ejecutar tests + build**

Run: `pnpm test:integration printer-coverage && pnpm typecheck && pnpm lint && pnpm --filter web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/printer-coverage.ts packages/db/src/index.ts apps/web/app/admin/impresoras/page.tsx tests/integration/printer-coverage.test.ts
git commit -m "feat(admin): warn about enabled USB printers with no device assigned"
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
pnpm seed:staff && pnpm test:e2e
```
Expected: todo verde, cero skips (salvo la flakiness pre-existente ya documentada de algún e2e). Registrar conteos en el ledger.

- [ ] **Revisión de fase (opus)** vía superpowers:requesting-code-review sobre todo el diff de `feat/agente-c2b-a`, foco en: (1) que el sink USB real nunca se filtre al agente/DB/tests (el hueco registrable lo aísla; el agente no lo importa); (2) que el acotado por `device_id` impida que un agente imprima la USB de otro PC (y que las de red sigan acotadas por venue); (3) que el dispatch de `printToPrinter` preserve el camino TCP byte a byte; (4) que el cambio de `CreatePrinterInput`/`UpdatePrinterInput` a un descriptor `connection` no rompa el alta de impresora de red (e2e de D2 verde); (5) que el device siga sin poder escribir config (solo el owner/admin, vía la action); (6) el aviso de USB sin device.

---

## Self-Review del plan (hecho)

**1. Cobertura del spec:**
- Adaptador USB + sink inyectable + dispatch + `deviceKey` usb:: → Task 1. ✅
- Agente lee USB acotado por `device_id` + resuelve su propio device → Task 2. ✅
- `buildUsbConnection` + `PrinterConnection` unión + create/update con tipo + deviceId → Task 3. ✅
- PrinterForm selector Red/USB → Task 4. ✅
- Aviso de USB sin `device_id` → Task 5. ✅
- Cero migraciones (columnas ya existen, `connection` jsonb libre) — ninguna task añade SQL. ✅
- Device nunca escribe config (todo por Server Action `managerAction`) — Tasks 3/4 no dan al device ningún camino de escritura. ✅

**2. Placeholders:** ninguno — todo el código está escrito.

**3. Consistencia de tipos:** `PrinterConfig` unión (Task 1) ↔ construida por el agente (Task 2) con `adapter:"escpos-tcp"|"escpos-usb"`. `UsbRawSink`/`registerUsbRawSink` (Task 1) ↔ usados en los tests de Task 1 y Task 2. `PrinterConnection`/`PrinterConnectionInput`/`buildUsbConnection` (Task 3) ↔ `createPrinter`/actions. `usbPrintersWithoutDevice` (Task 5). `deviceKey` acepta la unión en ambas ramas.

**Riesgos anotados:** Task 3 cambia la forma de `CreatePrinterInput`/`UpdatePrinterInput` (de host/port sueltos a `connection`), así que toca repo + actions en la MISMA task para no dejar un estado intermedio que no compile; la UI de red no cambia hasta Task 4. El sink es estado global de módulo en `@suarex/printing`: los tests lo registran en `beforeEach`/inline y lo restauran con `registerUsbRawSink(null)` en `afterEach` para no filtrar estado entre tests. El e2e de USB (Task 4) usa el tenant `garum` compartido; borra la impresora creada en `afterEach` (patrón de D2).
