# Panel de admin — Fase D2: mesas y QR, dispositivos, impresoras

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un `owner`/`admin` crea las mesas de su local y obtiene el QR de cada una listo para imprimir, da de alta un dispositivo de impresión y obtiene un código de emparejamiento real, y configura sus impresoras de red — todo desde el panel, sin SQL a mano; un `staff` no puede tocar nada de esto.

**Architecture:** Extiende el patrón de D1: repositorios `tenantScoped` en `packages/db`, Server Actions envueltas en `managerAction` (chequeo de rol estructural), pantallas funcionales. Cierra además el hueco heredado de que `devices`/`printers` permitían escritura a `staff`: pasan a escritura solo para `owner`/`admin`. El QR se genera en el servidor como imagen. El código de emparejamiento es criptográficamente aleatorio, se muestra una vez, y caduca en minutos.

**Tech Stack:** Next 16 App Router (Server Actions), Supabase (RLS), `qrcode` (generación de QR en servidor), `node:crypto`, TypeScript strict, Vitest, Playwright, Biome.

## Global Constraints

- Directorio único: `/Users/ivangonzalez/Documents/proyectos/suarex-platform`. **Prohibido escribir en** `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2`, `web-prueba`.
- Prohibido conectar o aplicar migraciones a los proyectos Supabase de producción. Solo el stack local. Nunca `supabase link`.
- Ninguna policy RLS puede ser `USING (true)`. Las formas permitidas viven en `tests/integration/helpers/policy-check.ts` por coincidencia exacta, acotadas por tabla; una forma nueva se añade **textual y exacta**, nunca se relaja la comparación.
- La escritura de configuración (mesas, dispositivos, impresoras) es solo para `owner`/`admin` vía `public.current_tenant_role()`. `staff` no gestiona; `device` ya está acotado y su lectura de impresoras (para construir tickets) se conserva.
- Toda Server Action de gestión va envuelta en `managerAction` y usa `session.tenantId`, nunca un tenant del cliente.
- El código de emparejamiento es ≥32 caracteres criptográficamente aleatorios (`crypto.randomBytes(24).toString("base64url")` o más), se devuelve **una sola vez** al crearlo, y caduca (por defecto 15 minutos). El CHECK del esquema exige ≥20; genera bastante más.
- Las imágenes de QR se generan en el servidor; el navegador no genera credenciales ni tokens.
- Impresoras: solo red en D2. `connection` = `{ "type": "network", "host": string, "port": number }`. USB (Windows RAW) es la fase C2.
- Prohibidos los literales hexadecimales de color en `apps/web` fuera del `:root` de `app/globals.css`.
- TypeScript strict. Prohibido `any` explícito, `@ts-ignore`, `@ts-expect-error`.
- Ningún test se salta en una ejecución por defecto.
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:tests`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` en verde al terminar cada tarea. Tras `supabase db reset`, el orden es `pnpm db:env` → `pnpm seed:staff`; preservar las tres variables de Stripe en `apps/web/.env.local`. La limpieza de fixtures está acotada; no re-sembrar entre integración y e2e.
- Conventional Commits. Rama `feat/admin-d2`.

---

## Estructura de ficheros

```
supabase/migrations/
  20260722000008_device_printer_role_writes.sql   escritura de devices/printers → owner/admin
packages/db/src/
  admin-devices.ts       NUEVO: createDevice (genera código), regeneratePairingCode, listDevices, deleteDevice
  admin-tables.ts        NUEVO: createTable, updateTable, deleteTable, listTables
  admin-printers.ts      NUEVO: createPrinter, updatePrinter, deletePrinter, listPrinters
  index.ts               MODIFICAR: exports
apps/web/
  lib/qr.ts              NUEVO: genera el SVG del QR de una URL de mesa
  app/admin/mesas/page.tsx, actions.ts, TableForm.tsx, QrView.tsx
  app/admin/dispositivos/page.tsx, actions.ts, DeviceForm.tsx, PairingCodeView.tsx
  app/admin/impresoras/page.tsx, actions.ts, PrinterForm.tsx
tests/
  integration/device-printer-role-writes.test.ts
  integration/admin-devices.test.ts
  integration/admin-tables.test.ts
  integration/admin-printers.test.ts
  e2e/admin-d2.spec.ts
```

---

### Task 1: Escritura de `devices` y `printers` solo para owner/admin

Cierra el hueco heredado: hoy las policies de escritura de `devices`/`printers` solo excluyen `device`, así que un `staff` puede crear/borrar dispositivos e impresoras. D2 las acota a `owner`/`admin`, como el catálogo.

**Files:**
- Create: `supabase/migrations/20260722000008_device_printer_role_writes.sql`
- Modify: `tests/integration/helpers/policy-check.ts` (si la forma no está ya permitida para estas tablas)
- Test: `tests/integration/device-printer-role-writes.test.ts`

**Interfaces:**
- Consumes: `public.current_tenant_id()`, `public.current_tenant_role()`.
- Produces: `devices` y `printers` con escritura restringida a `owner`/`admin`, lectura sin cambios.

- [ ] **Step 1: Escribir el test que falla**

`tests/integration/device-printer-role-writes.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTenantFixture, nonce, signInAs, type TenantFixture } from "./helpers/tenants.js";

let tenant: TenantFixture; // owner
let staff: Awaited<ReturnType<typeof signInAs>>;
let venueId: string;

beforeAll(async () => {
  tenant = await createTenantFixture(`dpw-${nonce()}`);
  staff = await signInAs(tenant.tenantId, "staff");
  const { data: venue } = await admin
    .from("venues").insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: false })
    .select("id").single();
  venueId = venue?.id as string;
});

describe("escritura de dispositivos/impresoras por rol", () => {
  it("un owner PUEDE crear un dispositivo", async () => {
    const { error } = await tenant.client
      .from("devices").insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Agente" });
    expect(error).toBeNull();
  });

  it("un staff NO puede crear un dispositivo", async () => {
    const { error } = await staff
      .from("devices").insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Intento" });
    expect(error?.code).toBe("42501");
  });

  it("un owner PUEDE crear una impresora", async () => {
    const { error } = await tenant.client.from("printers").insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "Cocina",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
    });
    expect(error).toBeNull();
  });

  it("un staff NO puede crear una impresora", async () => {
    const { error } = await staff.from("printers").insert({
      tenant_id: tenant.tenantId, venue_id: venueId, name: "Intento",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
    });
    expect(error?.code).toBe("42501");
  });

  it("REGRESIÓN: un staff SIGUE pudiendo leer las impresoras (para el panel de comandas / device)", async () => {
    const { error } = await staff.from("printers").select("id").limit(1);
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm test:integration -- tests/integration/device-printer-role-writes.test.ts`
Expected: FAIL — hoy un `staff` puede insertar dispositivos e impresoras.

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20260722000008_device_printer_role_writes.sql`:
```sql
-- Cierra el hueco heredado del canal QR: las policies de escritura de devices y
-- printers (creadas en 000005) solo excluían al rol `device`, de modo que un
-- `staff` podía crear/borrar dispositivos e impresoras. La gestión de la
-- infraestructura del local es cosa de owner/admin, igual que el catálogo (000006).
-- La LECTURA no cambia: staff y device siguen leyendo impresoras (device las
-- necesita para construir tickets); staff/owner/admin siguen viendo dispositivos.

-- ---- devices ----
-- 000005 creó devices_insert / devices_update / devices_delete, cada una excluyendo
-- solo 'device'. Se recrean exigiendo owner/admin. Confirma los nombres exactos con
--   select policyname, cmd from pg_policies where tablename='devices';
-- antes de dropear.
drop policy devices_insert on public.devices;
drop policy devices_update on public.devices;
drop policy devices_delete on public.devices;
create policy devices_write on public.devices
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));
-- Nota: una policy `for all` write cubre también SELECT vía OR con las policies de
-- SELECT existentes (devices_select_tenant, devices_select_own), que NO se tocan, así
-- que la visibilidad por rol se conserva. Verifícalo tras aplicar.

-- ---- printers ----
drop policy printers_insert on public.printers;
drop policy printers_update on public.printers;
drop policy printers_delete on public.printers;
create policy printers_write on public.printers
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));
-- printers_select (tenant_id = current_tenant_id(), abierta a todo el tenant incluido
-- device) NO se toca.
```

Nota para quien implemente: **verifica los nombres reales de las policies con `pg_policies` antes de dropear** — un nombre equivocado aborta todo el batch. Y confirma tras aplicar que `device` sigue SIN poder escribir (la nueva `_write` exige owner/admin, que un device nunca es) y SÍ leyendo impresoras.

- [ ] **Step 4: Aplicar y ajustar el allowlist**

Run: `supabase db reset && pnpm db:env && pnpm seed:staff && pnpm test:integration`
Expected: si la forma `owner/admin-write` del allowlist (de D1) está acotada a las 7 tablas de config, la suite anti-fuga FALLARÁ porque `devices`/`printers` usan ahora esa misma forma pero no están en su lista de tablas. Amplía la entrada del allowlist para incluir `devices` y `printers` (la forma es idéntica; solo se añaden dos tablas a su conjunto). Verifica la forma exacta con `pg_policies` como en D1. Nunca relajes la comparación.

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm test:integration`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260722000008_device_printer_role_writes.sql tests/integration/helpers/policy-check.ts tests/integration/device-printer-role-writes.test.ts
git commit -m "feat(db): restrict device and printer writes to owner/admin"
```

---

### Task 2: Mesas — repositorio, acciones y generación de QR

**Files:**
- Create: `packages/db/src/admin-tables.ts`; Modify: `packages/db/src/index.ts`
- Create: `apps/web/lib/qr.ts`
- Create: `apps/web/app/admin/mesas/actions.ts`
- Test: `tests/integration/admin-tables.test.ts`, `apps/web/lib/qr.test.ts`

**Interfaces:**
- Consumes: `tenantScoped("tables", tenantId)`; `managerAction`; `requireManager`.
- Produces:
  - `createTable(tenantId, { venueId, label, sortOrder }): Promise<{ id: string; token: string }>`
  - `updateTable(tenantId, id, patch): Promise<void>`
  - `deleteTable(tenantId, id): Promise<void>`
  - `listTables(tenantId): Promise<TableRow[]>`
  - `tableQrSvg(url: string): Promise<string>` — SVG del QR de la URL
  - Server Actions `createTableAction`, `updateTableAction`, `deleteTableAction`

- [ ] **Step 1: Instalar la librería de QR**

```bash
pnpm --filter @suarex/web add qrcode
pnpm --filter @suarex/web add -D @types/qrcode
```

- [ ] **Step 2: Escribir los tests que fallan**

`apps/web/lib/qr.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { tableQrSvg } from "./qr.js";

describe("tableQrSvg", () => {
  it("genera un SVG que contiene la estructura de un QR", async () => {
    const svg = await tableQrSvg("http://garum.localhost:3000/m/abc");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("rechaza una cadena vacía", async () => {
    await expect(tableQrSvg("")).rejects.toThrow();
  });
});
```

`tests/integration/admin-tables.test.ts`: `createTable` crea una fila con un `token` uuid; `listTables` la devuelve; el `token` sirve en `findTableByToken`; un `venueId` de otro tenant es rechazado (trigger `assert_same_tenant`); el `label` duplicado en el mismo venue es rechazado (unique).

- [ ] **Step 3: Implementar**

`apps/web/lib/qr.ts`:
```ts
import QRCode from "qrcode";

/** SVG del QR de la URL de una mesa. Se genera en el servidor; el cliente solo lo muestra. */
export async function tableQrSvg(url: string): Promise<string> {
  if (!url) throw new Error("URL vacía");
  return QRCode.toString(url, { type: "svg", margin: 1, width: 240 });
}
```

`packages/db/src/admin-tables.ts`: `createTable`/`updateTable`/`deleteTable`/`listTables` siguiendo exactamente el patrón de `admin-catalog.ts` (`tenantScoped("tables", tenantId)`, throw on error). `createTable` devuelve `{ id, token }` (el token lo genera la base con su default).

`apps/web/app/admin/mesas/actions.ts`: cada acción envuelta en `managerAction`, usando `session.tenantId`. La URL del QR se compone del Host del tenant y el token: `https://{host}/m/{token}` — el Host sale de la petición, no del cliente.

- [ ] **Step 4 → 5: Verificar (RED→GREEN) y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration`

```bash
git add packages/db/src/admin-tables.ts packages/db/src/index.ts apps/web/lib/qr.ts apps/web/app/admin/mesas/actions.ts tests/integration/admin-tables.test.ts apps/web/lib/qr.test.ts pnpm-lock.yaml
git commit -m "feat: table management with server-side QR generation"
```

---

### Task 3: Dispositivos — generación del código de emparejamiento

La tarea de seguridad de la fase: genera las credenciales de acceso de un dispositivo. Hoy solo existe la redención (`pairDevice`); esta tarea construye el lado de generación.

**Files:**
- Create: `packages/db/src/admin-devices.ts`; Modify: `packages/db/src/index.ts`, `packages/db/src/client.ts` (si `devices` no está en la unión de `tenantScoped`, añadirlo o usar un accesor estrecho)
- Create: `apps/web/app/admin/dispositivos/actions.ts`
- Test: `tests/integration/admin-devices.test.ts`

**Interfaces:**
- Consumes: `tenantScoped`; el CHECK de `pairing_code` (≥20); `pairDevice` (para el test de ida y vuelta).
- Produces:
  - `createDevice(tenantId, { venueId, name, ttlMinutes? }): Promise<{ id: string; pairingCode: string; expiresAt: string }>` — genera un código cripto ≥32 chars, lo guarda, devuelve el código EN CLARO una sola vez
  - `regeneratePairingCode(tenantId, deviceId, ttlMinutes?): Promise<{ pairingCode: string; expiresAt: string }>` — solo si el dispositivo no está ya emparejado
  - `listDevices(tenantId): Promise<DeviceRow[]>` — sin exponer el `pairing_code` en claro (solo si hay uno pendiente y cuándo caduca)
  - `deleteDevice(tenantId, id): Promise<void>`
  - Server Actions correspondientes

- [ ] **Step 1: Escribir el test que falla**

`tests/integration/admin-devices.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { createDevice, regeneratePairingCode } from "@suarex/db";
import { pairDevice } from "@suarex/db";
import { admin, createTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

let tenant: TenantFixture;
let venueId: string;

beforeAll(async () => {
  tenant = await createTenantFixture(`adev-${nonce()}`);
  const { data: v } = await admin
    .from("venues").insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id").single();
  venueId = v?.id as string;
});

describe("createDevice", () => {
  it("genera un código largo y aleatorio que empareja de verdad", async () => {
    const created = await createDevice(tenant.tenantId, { venueId, name: "Agente cocina" });
    expect(created.pairingCode.length).toBeGreaterThanOrEqual(32);

    // El código recién generado canjea correctamente (ida y vuelta con pairDevice).
    const paired = await pairDevice(created.pairingCode);
    expect(paired?.tenantId).toBe(tenant.tenantId);
  });

  it("dos dispositivos generan códigos distintos", async () => {
    const a = await createDevice(tenant.tenantId, { venueId, name: "A" });
    const b = await createDevice(tenant.tenantId, { venueId, name: "B" });
    expect(a.pairingCode).not.toBe(b.pairingCode);
  });

  it("un código caduca según ttlMinutes", async () => {
    const created = await createDevice(tenant.tenantId, { venueId, name: "C", ttlMinutes: -1 });
    // Ya caducado: no empareja.
    expect(await pairDevice(created.pairingCode)).toBeNull();
  });

  it("no se puede regenerar el código de un dispositivo ya emparejado", async () => {
    const created = await createDevice(tenant.tenantId, { venueId, name: "D" });
    await pairDevice(created.pairingCode); // ahora está paired
    await expect(regeneratePairingCode(tenant.tenantId, created.id)).rejects.toThrow();
  });
});
```

- [ ] **Step 2 → 4: Implementar (TDD)**

`packages/db/src/admin-devices.ts`:
```ts
import { randomBytes } from "node:crypto";
import { tenantScoped } from "./client.js";

function generatePairingCode(): string {
  // 24 bytes → 32 chars base64url. Muy por encima del mínimo de 20 del CHECK.
  return randomBytes(24).toString("base64url");
}

export async function createDevice(
  tenantId: string,
  input: { venueId: string; name: string; ttlMinutes?: number },
): Promise<{ id: string; pairingCode: string; expiresAt: string }> {
  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + (input.ttlMinutes ?? 15) * 60_000).toISOString();

  const { data, error } = await tenantScoped("devices", tenantId)
    .insert({
      venue_id: input.venueId,
      name: input.name,
      pairing_code: pairingCode,
      pairing_expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw error;

  return { id: data.id as string, pairingCode, expiresAt };
}
```
`regeneratePairingCode` hace un `update` de `pairing_code`/`pairing_expires_at` con guarda `.is("paired_at", null)`; si afecta 0 filas (ya emparejado o no existe), lanza. `listDevices` selecciona sin el `pairing_code` en claro — solo un booleano "tiene código pendiente" y `pairing_expires_at`. `deleteDevice` borra la fila (cascada de `printers.device_id` a NULL).

Si `devices` no está en la unión `TenantScopedTable` de `client.ts`, añádelo (es una tabla con `tenant_id`, encaja) — con eso `tenantScoped("devices", tenantId)` funciona con el `tenant_id` forzado.

`apps/web/app/admin/dispositivos/actions.ts`: `createDeviceAction` envuelta en `managerAction`, devuelve el código para mostrarlo una vez. **El código en claro solo viaja en la respuesta de esta acción, nunca se registra en logs ni se vuelve a leer de la base.**

- [ ] **Step 5: Verificar y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration`

```bash
git add packages/db apps/web/app/admin/dispositivos/actions.ts tests/integration/admin-devices.test.ts
git commit -m "feat(db): device pairing-code generation for the admin side"
```

---

### Task 4: Impresoras — repositorio y acciones

**Files:**
- Create: `packages/db/src/admin-printers.ts`; Modify: `packages/db/src/index.ts`
- Create: `apps/web/app/admin/impresoras/actions.ts`
- Test: `tests/integration/admin-printers.test.ts`

**Interfaces:**
- Consumes: `tenantScoped("printers", tenantId)`; `managerAction`.
- Produces:
  - `createPrinter(tenantId, { venueId, name, host, port, destination, deviceId?, isDefault?, enabled? }): Promise<{ id: string }>`
  - `updatePrinter`, `deletePrinter`, `listPrinters`
  - Server Actions correspondientes

- [ ] **Step 1: Escribir el test**

`tests/integration/admin-printers.test.ts`: `createPrinter` guarda `connection = { type: "network", host, port }` y `destination`; un `port` no numérico o fuera de rango (1-65535) es rechazado en el repositorio; un `host` vacío es rechazado; un `deviceId` de otro tenant es rechazado (trigger); `listPrinters` las devuelve.

- [ ] **Step 2 → 4: Implementar (TDD)**

`packages/db/src/admin-printers.ts` con `createPrinter` que valida `host` no vacío y `port` entero en 1..65535 (lanza si no), compone `connection = { type: "network", host, port }`, e inserta vía `tenantScoped("printers", tenantId)`. El resto siguiendo el patrón. La validación vive en el repositorio, no solo en la acción, para proteger a todos los llamantes.

`apps/web/app/admin/impresoras/actions.ts`: acciones envueltas en `managerAction`, con `session.tenantId`, `revalidatePath("/admin/impresoras")`.

- [ ] **Step 5: Verificar y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration`

```bash
git add packages/db apps/web/app/admin/impresoras/actions.ts tests/integration/admin-printers.test.ts
git commit -m "feat(db): network printer configuration repository and actions"
```

---

### Task 5: Pantallas y e2e

**Files:**
- Create: las pantallas `page.tsx`/`*Form.tsx`/`QrView.tsx`/`PairingCodeView.tsx` de mesas, dispositivos e impresoras
- Test: `tests/e2e/admin-d2.spec.ts`

**Interfaces:**
- Consumes: `requireManager`, `listTables`/`listDevices`/`listPrinters`, `tableQrSvg`, las Server Actions.

- [ ] **Step 1: Escribir el e2e que falla**

`tests/e2e/admin-d2.spec.ts` (usando el `owner` demo sembrado en D1):
```ts
import { expect, test } from "@playwright/test";

const OWNER_PASSWORD = process.env.OWNER_SEED_PASSWORD;
test.skip(!OWNER_PASSWORD, "Falta OWNER_SEED_PASSWORD (ver README)");

// beforeAll que falla ruidoso si falta el owner, como en admin-catalogo.spec.ts.

test("un owner crea una mesa y ve su QR", async ({ page }) => {
  // login owner → /admin/mesas → crear mesa "12" → aparece con un <svg> de QR
});

test("un owner da de alta un dispositivo y ve el código una vez", async ({ page }) => {
  // login owner → /admin/dispositivos → crear "Agente cocina" → se muestra un código ≥32 chars
  // recargar la página → el código ya NO se muestra (era de un solo uso visual)
});

test("un owner configura una impresora de red", async ({ page }) => {
  // login owner → /admin/impresoras → crear "Cocina" host 127.0.0.1 port 9100 destino cocina → aparece en la lista
});

test("un staff no ve la gestión de mesas/dispositivos/impresoras", async ({ page }) => {
  // login staff → /admin/mesas → redirigido a /staff/login
});
```

Recuerda: nada de `test.skip` que oculte un prerequisito de forma silenciosa salvo la env var de contraseña, y con el `beforeAll` que falla ruidoso — el mismo patrón que ya usa `admin-catalogo.spec.ts`. La limpieza de lo que cada test crea va en `afterEach`, acotada, y sobrevive a un fallo (lección de D1).

- [ ] **Step 2 → 4: Implementar las pantallas (TDD)**

Cada `page.tsx` (servidor): `requireManager()`, lista con el repositorio correspondiente, formulario con la Server Action. Siguen el patrón de `admin/catalogo/page.tsx`. Funcional, sin diseño; variables CSS del tenant; sin hex literales.

- `mesas`: lista de mesas con su `label` y un botón/vista que muestra el `<svg>` del QR (`tableQrSvg` de la URL `/m/{token}`), con opción de imprimir (el navegador imprime el SVG). Aviso al borrar.
- `dispositivos`: lista con nombre, venue, estado (emparejado o código pendiente + caducidad). Al crear, `PairingCodeView` muestra el código UNA vez con la instrucción de introducirlo en la app; botón de regenerar si no está emparejado.
- `impresoras`: lista con nombre, host:port, destino, enabled. Formulario con host, port, destino, dispositivo (opcional).

- [ ] **Step 5: Criterio de aceptación de la fase D2**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`
Expected: todo verde, cero saltados. Ejecuta el e2e un par de veces para confirmar estabilidad.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/admin tests/e2e/admin-d2.spec.ts
git commit -m "feat(web): tables/devices/printers management screens and e2e"
```

---

## Verificación contra el spec

| Requisito del spec (D2) | Tarea |
|---|---|
| Escritura de dispositivos/impresoras solo owner/admin | 1 |
| `staff` conserva la lectura (device lee impresoras) | 1 (regresión) |
| Mesas: crear y generar QR | 2 |
| QR imprimible generado en servidor | 2, 5 |
| Dispositivos: código de emparejamiento real, cripto, caduca, una vez | 3 |
| No regenerar código de un dispositivo emparejado | 3 |
| Impresoras de red con host/puerto/destino | 4 |
| Pantallas de gestión | 5 |
| Un staff no gestiona nada de esto | 5 (e2e) |
| Anti-fuga sobre las policies nuevas | 1 (automática) |

## Fuera de la fase D2

Ajustes del negocio (marca, fiscal, IVA) y alta de personal (fase D3). Impresoras USB / Windows RAW (fase C2). El diseño visual del panel (paso posterior).

## Deuda consciente de esta fase

- El rate limiting de `POST /api/devices/pair` sigue diferido (registrado desde el canal QR). Con la generación de códigos ya existiendo, es un candidato claro para D3 o un endurecimiento propio.
- La revocación de sesión al regenerar/re-emparejar un dispositivo sigue pendiente (registrado en C1). Si `regeneratePairingCode` se usa sobre un dispositivo ya emparejado — que este plan prohíbe —, la cuestión no se plantea; pero cuando exista el re-emparejamiento real habrá que revocar la sesión anterior.
