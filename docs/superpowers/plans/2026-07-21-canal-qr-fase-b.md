# Canal QR — Fase B: la comanda es visible

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un pedido pagado desde el móvil de un comensal aparece solo, en segundos, en la pantalla de comandas del personal, separado en cocina y barra; y el comensal ve cómo avanza su pedido.

**Architecture:** El personal se autentica y lleva el claim de tenant en su JWT, así que se suscribe a Supabase Realtime directamente y RLS acota lo que recibe. El comensal es anónimo y nunca habla con Supabase: su pantalla de seguimiento consulta al servidor de Next con su `public_token`. Dos mecanismos distintos porque son dos niveles de confianza distintos.

**Tech Stack:** Next 16 App Router, Supabase Auth + Realtime, `@supabase/ssr` para la sesión del personal, Vitest, Playwright, Biome.

## Global Constraints

- Directorio de trabajo único: `/Users/ivangonzalez/Documents/proyectos/suarex-platform`. **Prohibido escribir en** `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2`, `web-prueba`.
- Prohibido conectar o aplicar migraciones a los proyectos Supabase de producción. Solo el stack local. Nunca `supabase link`.
- Ninguna policy RLS puede ser `USING (true)`. Las formas permitidas viven en `tests/integration/helpers/policy-check.ts` por coincidencia exacta; una forma nueva se **añade textualmente**, nunca se relaja la comparación.
- Toda tabla de dominio lleva `tenant_id uuid not null` con índice.
- La clave de **service role** no puede salir jamás al navegador. Solo `packages/db` la usa, y solo desde `src/client.ts`.
- El cliente de navegador usa exclusivamente la **anon key** y depende de RLS. Vive en su propio paquete para que no pueda arrastrar código de servidor por accidente.
- El comensal anónimo nunca habla directamente con Supabase.
- Prohibidos los literales hexadecimales de color en `apps/web` fuera del bloque `:root` de `app/globals.css`.
- Dinero en céntimos enteros; formatear solo en el borde.
- TypeScript strict. Prohibido `any` explícito, `@ts-ignore` y `@ts-expect-error`.
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:tests`, `pnpm test`, `pnpm test:integration` y `pnpm test:e2e` en verde al terminar cada tarea.
- `apps/web/.env.local` contiene claves de Stripe en modo test que **no** están en `.env.test`. Si regeneras `.env.local`, consérvalas.
- Mensajes de commit en formato Conventional Commits.

---

## Estructura de ficheros

```
packages/
  realtime/                        @suarex/realtime — NUEVO, solo anon key
    src/browser-client.ts          cliente de navegador, jamás service role
    src/orders-channel.ts          suscripción a pedidos del tenant
    src/index.ts
apps/web/
  app/staff/login/page.tsx         NUEVO: acceso del personal
  app/staff/page.tsx               NUEVO: panel de comandas
  app/staff/OrdersBoard.tsx        NUEVO: tablero en tiempo real (cliente)
  app/staff/actions.ts             NUEVO: marcar comanda servida
  app/pedido/[publicToken]/page.tsx        MODIFICAR: seguimiento en vivo
  app/pedido/[publicToken]/StatusPoller.tsx NUEVO: sondeo (cliente)
  app/api/pedido/[publicToken]/route.ts    NUEVO: estado por token público
  lib/supabase-server.ts           NUEVO: sesión SSR del personal
  proxy.ts                         MODIFICAR: refrescar sesión en /staff
supabase/migrations/
  20260721000006_memberships_lockdown.sql
  20260721000007_orders_realtime.sql
tests/
  integration/memberships-role.test.ts
  integration/realtime-isolation.test.ts
  e2e/staff-board.spec.ts
```

---

### Task 1: Cerrar `memberships.role`

Deuda heredada del sub-proyecto 1. Hoy `memberships_isolation` es `for all to authenticated`, así que un usuario con rol `staff` puede ejecutar `update memberships set role = 'owner' where user_id = auth.uid()` y, al refrescar el token, ser propietario. No es explotable todavía porque no existe ninguna interfaz autenticada — y ésta es la última tarea en la que eso sigue siendo cierto.

**Files:**
- Create: `supabase/migrations/20260721000006_memberships_lockdown.sql`
- Create: `tests/integration/memberships-role.test.ts`
- Modify: `tests/integration/helpers/policy-check.ts` (forma nueva, exacta)
- Modify: `tests/integration/tenant-isolation.test.ts` (`WRITE_FIXTURES`)

**Interfaces:**
- Consumes: `public.memberships`, `public.current_tenant_id()`.
- Produces: `memberships` legible por su tenant, no escribible por `authenticated`.

- [ ] **Step 1: Escribir el test que falla**

`tests/integration/memberships-role.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";
import type { TenantFixture } from "./helpers/tenants.js";

let fixture: TenantFixture;

beforeAll(async () => {
  fixture = await createTenantFixture(`mem-${nonce()}`);
});

describe("memberships", () => {
  it("un usuario ve su propia membresía", async () => {
    const { data, error } = await fixture.client
      .from("memberships")
      .select("role, tenant_id");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.tenant_id).toBe(fixture.tenantId);
  });

  it("NO puede ascenderse a owner", async () => {
    const { error } = await fixture.client
      .from("memberships")
      .update({ role: "owner" })
      .eq("tenant_id", fixture.tenantId);

    // Debe ser un rechazo de permisos, no un update silencioso de 0 filas.
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");

    const { data } = await admin
      .from("memberships")
      .select("role")
      .eq("tenant_id", fixture.tenantId)
      .single();
    expect(data?.role).toBe("owner");
  });

  it("NO puede insertar una membresía nueva", async () => {
    const { error } = await fixture.client.from("memberships").insert({
      tenant_id: fixture.tenantId,
      user_id: fixture.userId,
      role: "admin",
    });
    expect(error?.code).toBe("42501");
  });

  it("NO puede borrar su membresía", async () => {
    const { error } = await fixture.client
      .from("memberships")
      .delete()
      .eq("tenant_id", fixture.tenantId);
    expect(error?.code).toBe("42501");
  });
});
```

Nota: `createTenantFixture` crea al usuario con rol `owner`, y `TenantFixture` ya expone `userId`, así que el test lo puede usar tal cual.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm test:integration -- tests/integration/memberships-role.test.ts`
Expected: FAIL. El ascenso a `owner` tiene éxito hoy: el update no da error.

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20260721000006_memberships_lockdown.sql`:
```sql
-- La pertenencia a un tenant y el rol dentro de él son decisiones de
-- administración, no datos que el propio usuario pueda editar. Sin esto, un
-- `staff` puede ascenderse a `owner` con un solo UPDATE y, al refrescar el
-- token, el hook de acceso le inyecta el claim nuevo.
--
-- Se revoca la escritura a `authenticated` por completo. Cuando exista el panel
-- de administración (sub-proyecto 5), las altas y cambios de rol pasarán por el
-- servidor con service role y comprobación explícita de permisos, no por
-- PostgREST directamente.

drop policy if exists memberships_isolation on public.memberships;

create policy memberships_read on public.memberships
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

revoke insert, update, delete, truncate on public.memberships from authenticated;
```

- [ ] **Step 4: Añadir la forma nueva al allowlist**

`memberships_read` es una policy de `SELECT`, así que solo tiene `qual`. Su forma canónica es la ya permitida `(tenant_id = current_tenant_id())`, de modo que **no debería hacer falta ningún cambio** en `policy-check.ts`. Ejecuta el test de formas canónicas y compruébalo. Si hiciera falta, añade la forma **textual exacta**; nunca relajes la comparación.

- [ ] **Step 5: Ajustar `WRITE_FIXTURES`**

La suite anti-fuga espera hoy que un INSERT cross-tenant en `memberships` sea rechazado por RLS (`42501`). Tras revocar el privilegio, el rechazo sigue siendo `42501` pero por falta de permiso, no por policy. El UPDATE, que antes afectaba a 0 filas en silencio, ahora dará error.

Revisa la entrada de `memberships` en `WRITE_FIXTURES` y actualiza las expectativas al valor **correcto** observado. Eso no es debilitar el test: es reflejar un comportamiento que ha mejorado. Explica el cambio en tu informe.

- [ ] **Step 6: Ejecutar y verificar que pasa**

Run: `supabase db reset && pnpm db:env && pnpm test:integration`
Expected: PASS

- [ ] **Step 7: Verificar que el hook de acceso sigue funcionando**

El hook `custom_access_token_hook` es SECURITY DEFINER y lee `memberships` con los privilegios de su propietario, así que la revocación no debería afectarle. **Compruébalo, no lo asumas** — si el hook dejara de inyectar el claim, todo el sistema dejaría de ver datos y el fallo sería desconcertante.

```bash
docker exec -i "$(docker ps --filter name=supabase_db_suarex --format '{{.Names}}' | head -1)" \
  psql -U postgres -d postgres -c "
    select public.custom_access_token_hook(
      jsonb_build_object('user_id', (select user_id from public.memberships limit 1), 'claims', '{}'::jsonb)
    ) -> 'claims' ->> 'tenant_id' as tenant_claim;"
```
Expected: un uuid, no `NULL`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260721000006_memberships_lockdown.sql tests/integration/memberships-role.test.ts tests/integration/tenant-isolation.test.ts
git commit -m "fix(db): make memberships read-only for authenticated users"
```

---

### Task 2: Realtime en `orders` y prueba de aislamiento

Ésta es la tarea crítica de la fase. El panel del personal se suscribe a los cambios de `orders` por Realtime. **No se puede dar por supuesto que RLS se aplique a esos eventos.** Si no se aplicara, el panel de un restaurante recibiría los pedidos de otro — una fuga en tiempo real que ninguna prueba de consulta detectaría.

**Files:**
- Create: `supabase/migrations/20260721000007_orders_realtime.sql`
- Create: `tests/integration/realtime-isolation.test.ts`

**Interfaces:**
- Consumes: `public.orders`, sesiones autenticadas de `tests/integration/helpers/tenants.ts`.
- Produces: `orders` publicada en `supabase_realtime`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/20260721000007_orders_realtime.sql`:
```sql
-- El panel de comandas se suscribe a los cambios de `orders`. Realtime respeta
-- RLS para `postgres_changes` cuando el cliente está autenticado, así que cada
-- usuario solo debe recibir eventos de su propio tenant. Eso NO se da por
-- supuesto: `tests/integration/realtime-isolation.test.ts` lo demuestra.
alter publication supabase_realtime add table public.orders;

-- `replica identity full` hace que el payload de UPDATE incluya la fila
-- anterior completa. Sin esto, un UPDATE solo trae las columnas modificadas y
-- el filtrado por tenant del lado del cliente no puede confiarse.
alter table public.orders replica identity full;
```

- [ ] **Step 2: Escribir la prueba de aislamiento en tiempo real**

`tests/integration/realtime-isolation.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let channel: RealtimeChannel;
const received: { tenant_id: string }[] = [];

beforeAll(async () => {
  tenantA = await createTenantFixture(`rt-a-${nonce()}`);
  tenantB = await createTenantFixture(`rt-b-${nonce()}`);
  await seedCatalog(tenantA.tenantId, "a");
  await seedCatalog(tenantB.tenantId, "b");

  // El personal de A se suscribe con SU sesión autenticada.
  channel = tenantA.client
    .channel(`tenant:${tenantA.tenantId}:orders`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "orders" },
      (payload) => {
        received.push(payload.new as { tenant_id: string });
      },
    );

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error(`No se pudo suscribir: ${status}`));
      }
    });
  });
});

afterAll(async () => {
  await channel.unsubscribe();
  await deleteTenantFixture(tenantA);
  await deleteTenantFixture(tenantB);
});

describe("aislamiento de Realtime", () => {
  it("el personal de A NO recibe pedidos de B", async () => {
    // Control positivo primero: si A no recibe NADA, el test no prueba nada.
    await insertOrder(tenantA.tenantId);
    await insertOrder(tenantB.tenantId);
    await waitFor(3000);

    const fromA = received.filter((r) => r.tenant_id === tenantA.tenantId);
    const fromB = received.filter((r) => r.tenant_id === tenantB.tenantId);

    expect(fromA.length, "A no recibió su propio pedido: la suscripción no funciona").toBeGreaterThan(0);
    expect(fromB, "FUGA: A recibió un pedido de B por Realtime").toHaveLength(0);
  });
});

async function insertOrder(tenantId: string): Promise<void> {
  const { data: venue } = await admin
    .from("venues")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .single();

  const { error } = await admin.from("orders").insert({
    tenant_id: tenantId,
    venue_id: venue?.id,
    order_number: 1,
  });
  if (error) throw error;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

El **control positivo** es lo que hace que este test valga algo. Sin él, una suscripción rota daría verde: cero eventos de B es trivialmente cierto si no llega ningún evento en absoluto.

- [ ] **Step 3: Ejecutar y ver el resultado real**

Run: `supabase db reset && pnpm db:env && pnpm test:integration -- tests/integration/realtime-isolation.test.ts`

**No asumas el resultado.** Hay dos desenlaces posibles y ambos son información:
- **Pasa**: RLS se aplica a Realtime. Sigue a la Task 3.
- **Falla con fuga**: RLS NO acota los eventos. Es un hallazgo grave que cambia el diseño. **Para y repórtalo** en vez de intentar arreglarlo por tu cuenta: la solución (filtrar por tenant en el servidor y reemitir, o usar Broadcast autorizado en vez de `postgres_changes`) es una decisión de arquitectura, no un parche.

- [ ] **Step 4: Verificar que la fuga se detectaría**

Solo si el Step 3 pasó. Comprueba que el test **puede** fallar: quita temporalmente la policy de `orders` (`drop policy orders_isolation on public.orders;` con RLS aún activa no basta, porque sin policy nadie ve nada — usa en su lugar una policy temporal permisiva `using (true)`), ejecuta el test, confirma que detecta la fuga, y restaura.

Paste ambos resultados. Un test de aislamiento que nunca ha fallado no es evidencia de nada.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721000007_orders_realtime.sql tests/integration/realtime-isolation.test.ts
git commit -m "feat(db): publish orders to realtime with proven tenant isolation"
```

---

### Task 3: `@suarex/realtime` y sesión del personal

**Files:**
- Create: `packages/realtime/{package.json,tsconfig.json,src/browser-client.ts,src/orders-channel.ts,src/index.ts}`
- Create: `apps/web/lib/supabase-server.ts`, `apps/web/app/staff/login/page.tsx`
- Modify: `apps/web/proxy.ts` (refrescar sesión en `/staff`)
- Modify: `supabase/seed.sql` (usuario de personal para los tenants demo)

**Interfaces:**
- Produces:
  - `createBrowserClient(url: string, anonKey: string): SupabaseClient`
  - `subscribeToOrders(client, tenantId, onChange): () => void` — devuelve la función de baja
  - `getStaffSession(): Promise<{ userId: string; tenantId: string } | null>` en el servidor

- [ ] **Step 1: Crear el paquete con la anon key aislada**

`packages/realtime/package.json`:
```json
{
  "name": "@suarex/realtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "@supabase/supabase-js": "^2.95.3" },
  "devDependencies": { "typescript": "^5.9.3" }
}
```

`packages/realtime/src/browser-client.ts`:
```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente para el NAVEGADOR. Usa exclusivamente la anon key y depende de RLS
 * para acotar lo que ve cada usuario.
 *
 * Este paquete existe separado de `@suarex/db` precisamente para que no pueda
 * arrastrar código de servidor: `@suarex/db` lee `SUPABASE_SERVICE_ROLE_KEY`, y
 * un import descuidado desde un componente de cliente podría acabar metiendo esa
 * clave en el bundle. Aquí eso es imposible porque este paquete no la conoce.
 *
 * NUNCA añadas a este paquete nada que lea una clave de servicio.
 */
export function createBrowserClient(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) throw new Error("URL y anon key son obligatorias");
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
```

`packages/realtime/src/orders-channel.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type OrderChangePayload = {
  id: string;
  tenant_id: string;
  status: string;
  kitchen_status: string;
  bar_status: string;
  order_number: number;
};

/**
 * El nombre del canal lleva el tenant para que dos negocios no compartan tráfico,
 * pero el canal NO es la garantía de aislamiento: la garantía es RLS, que se
 * aplica a los eventos y está demostrada en `tests/integration/realtime-isolation.test.ts`.
 * Un nombre de canal es una convención; una policy es un control.
 */
export function subscribeToOrders(
  client: SupabaseClient,
  tenantId: string,
  onChange: (order: OrderChangePayload) => void,
): () => void {
  const channel = client
    .channel(`tenant:${tenantId}:orders`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      (payload) => {
        const row = payload.new as OrderChangePayload | null;
        if (row) onChange(row);
      },
    )
    .subscribe();

  return () => {
    void channel.unsubscribe();
  };
}
```

`packages/realtime/src/index.ts`:
```ts
export { createBrowserClient } from "./browser-client.js";
export type { OrderChangePayload } from "./orders-channel.js";
export { subscribeToOrders } from "./orders-channel.js";
```

- [ ] **Step 2: Permitir el import en el paquete nuevo**

`biome.json` prohíbe importar `@supabase/supabase-js` fuera de `packages/db/src/**` y `tests/integration/helpers/**`. Añade `packages/realtime/src/**` a esa lista de excepciones, con un comentario explicando por qué es seguro: este paquete solo conoce la anon key.

Verifica después que `apps/web` **sigue** sin poder importarlo directamente: crea un fichero sonda en `apps/web`, ejecuta `pnpm lint`, confirma el error, y bórralo.

- [ ] **Step 3: Sesión del personal en el servidor**

Antes de nada, faltan dos variables. `apps/web/.env.local` tiene hoy `SUPABASE_URL` y `SUPABASE_ANON_KEY`, pero **sin el prefijo `NEXT_PUBLIC_`**, así que el navegador no las ve. El cliente de navegador y el de sesión SSR las necesitan expuestas:

```
NEXT_PUBLIC_SUPABASE_URL=<mismo valor que SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<mismo valor que SUPABASE_ANON_KEY>
```

Añádelas a `apps/web/.env.local`, a `.env.example`, y haz que `scripts/write-test-env.mjs` las emita también, para que no vuelvan a faltar tras un `pnpm db:env`.

Que la anon key llegue al navegador es correcto y esperado: es pública por diseño y RLS es lo que acota qué ve cada usuario. La que **jamás** puede salir al bundle es `SUPABASE_SERVICE_ROLE_KEY`, que no lleva ni debe llevar el prefijo.

```bash
pnpm --filter @suarex/web add @supabase/ssr
```

`apps/web/lib/supabase-server.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de servidor con la sesión del personal, basado en cookies. Usa la
 * anon key: RLS acota lo que ve, exactamente igual que en el navegador.
 */
export async function staffServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        for (const item of items) cookieStore.set(item.name, item.value, item.options);
      },
    },
  });
}

export type StaffSession = { userId: string; tenantId: string };

/**
 * Devuelve la sesión del personal, o null. El `tenant_id` se lee del CLAIM del
 * JWT, no de una cabecera ni de un parámetro: es lo único que el usuario no
 * puede falsificar.
 */
export async function getStaffSession(): Promise<StaffSession | null> {
  const client = await staffServerClient();
  const { data } = await client.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;

  const tenantId = claims.tenant_id;
  if (typeof tenantId !== "string") return null;

  return { userId: claims.sub as string, tenantId };
}
```

Nota importante: usa `getClaims()` o `getUser()`, **nunca** `getSession()` para tomar decisiones de autorización en el servidor — `getSession()` devuelve lo que hay en la cookie sin verificar la firma.

- [ ] **Step 4: Sembrar un usuario de personal**

Los usuarios viven en `auth.users`, que `supabase/seed.sql` no debe tocar directamente. Crea `scripts/seed-staff.mjs` que use la API de administración para dar de alta un usuario por tenant demo y su fila en `memberships` con rol `staff`, y añade el script a `package.json` como `seed:staff`.

Documenta las credenciales de desarrollo en el README. Son de un stack local desechable; aun así, no reutilices una contraseña real.

- [ ] **Step 5: Página de acceso**

`apps/web/app/staff/login/page.tsx`: formulario de email y contraseña que llama a `signInWithPassword` con el cliente de navegador y redirige a `/staff`. Sin estilos más allá de lo funcional.

- [ ] **Step 6: Refrescar la sesión en el middleware**

`apps/web/proxy.ts` ya resuelve el tenant por `Host`. Añade, **solo para rutas `/staff`**, el refresco de la sesión de Supabase. No toques la lógica de resolución de tenant ni el borrado de cabeceras forjadas: ese mecanismo es el que impide suplantar un tenant y está documentado en `lib/tenant-context.ts`.

- [ ] **Step 7: Verificar y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`

```bash
git add packages/realtime apps/web biome.json scripts/seed-staff.mjs package.json pnpm-lock.yaml
git commit -m "feat(realtime): browser client and staff session"
```

---

### Task 4: Panel de comandas

**Files:**
- Create: `apps/web/app/staff/page.tsx`, `apps/web/app/staff/OrdersBoard.tsx`, `apps/web/app/staff/actions.ts`
- Create: `packages/db/src/staff-orders.ts`; Modify: `packages/db/src/index.ts`
- Test: `tests/e2e/staff-board.spec.ts`

**Interfaces:**
- Produces:
  - `listActiveOrders(tenantId): Promise<StaffOrder[]>`
  - `markStationDone(tenantId, orderId, station: "cocina" | "barra"): Promise<void>`
  - `type StaffOrder = { id, orderNumber, tableLabel, status, kitchenStatus, barStatus, items: { name, quantity, destination, notes }[] }`

- [ ] **Step 1: Escribir el e2e que falla**

`tests/e2e/staff-board.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test("sin sesión, /staff redirige al acceso", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/staff");
  await expect(page).toHaveURL(/\/staff\/login/);
});

test("un pedido pagado aparece en el panel", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email").fill("staff@garum.local");
  await page.getByLabel("Contraseña").fill(process.env.STAFF_DEV_PASSWORD ?? "");
  await page.getByRole("button", { name: /entrar/i }).click();

  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByTestId("order-card")).toHaveCount(0);

  // El pedido se crea por la API pública, como lo haría un comensal real.
  const response = await page.request.post("http://garum.localhost:3000/api/orders", {
    data: {
      tableToken: "11111111-1111-1111-1111-111111111111",
      lines: [{ productId: await firstProductId(page), quantity: 1, extraIds: [], notes: null }],
    },
  });
  expect(response.ok()).toBeTruthy();

  // Llega solo, sin recargar: eso es lo que prueba Realtime.
  await expect(page.getByTestId("order-card")).toHaveCount(1, { timeout: 10_000 });
});

async function firstProductId(page: import("@playwright/test").Page): Promise<string> {
  const response = await page.request.get(
    "http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111",
  );
  const html = await response.text();
  const match = html.match(/data-product-id="([0-9a-f-]{36})"/);
  if (!match?.[1]) throw new Error("No se encontró ningún producto en la carta");
  return match[1];
}
```

Para que `firstProductId` funcione, añade `data-product-id` al elemento de producto en `CartClient.tsx`.

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm test:e2e -- tests/e2e/staff-board.spec.ts`
Expected: FAIL — la ruta `/staff` no existe.

- [ ] **Step 3: Repositorio de comandas**

`packages/db/src/staff-orders.ts` con `listActiveOrders` y `markStationDone`, ambos usando `tenantScoped`. `markStationDone` actualiza `kitchen_status` o `bar_status` y, cuando ambos quedan fuera de `pending`, pasa `status` a `served`.

**Cuidado con la autorización:** el `tenantId` debe venir del claim del JWT vía `getStaffSession()`, nunca de un parámetro que el navegador controle. Una Server Action que aceptara `tenantId` del cliente sería exactamente el agujero que el resto del sistema evita.

- [ ] **Step 4: Página y tablero**

`app/staff/page.tsx` (servidor): comprueba `getStaffSession()`, redirige a `/staff/login` si no hay, carga `listActiveOrders` y pasa los datos a `OrdersBoard`.

`app/staff/OrdersBoard.tsx` (cliente): renderiza dos columnas, cocina y barra, con `data-testid="order-card"` por comanda; se suscribe con `subscribeToOrders` y refresca al recibir un evento; botón de marcar servido que llama a la Server Action.

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm test:e2e -- tests/e2e/staff-board.spec.ts`
Expected: PASS

- [ ] **Step 6: Probar el aislamiento en el navegador**

Con dos sesiones de personal, una por tenant, crea un pedido en cada uno y comprueba que ninguno ve el del otro. Añádelo como test e2e, con **control positivo**: cada panel debe ver el suyo, o el test no prueba nada.

- [ ] **Step 7: Commit**

```bash
git add apps/web packages/db tests/e2e/staff-board.spec.ts
git commit -m "feat(web): realtime kitchen and bar order board"
```

---

### Task 5: Seguimiento en vivo para el comensal

**Files:**
- Create: `apps/web/app/api/pedido/[publicToken]/route.ts`, `apps/web/app/pedido/[publicToken]/StatusPoller.tsx`
- Modify: `apps/web/app/pedido/[publicToken]/page.tsx`

- [ ] **Step 1: Endpoint de estado**

`GET /api/pedido/{publicToken}` devuelve `{ orderNumber, status, totalCents, currency }` usando `getOrderByPublicToken`, o 404. **No devuelve nada más**: ni identificadores internos, ni el tenant, ni las líneas. El token identifica un pedido, no autoriza a ver el negocio.

- [ ] **Step 2: Sondeo en cliente**

`StatusPoller.tsx` consulta ese endpoint cada 5 segundos y deja de hacerlo cuando el estado es `served` o `cancelled`. Sin Supabase en el navegador del comensal: ése es el punto.

- [ ] **Step 3: Verificar**

Un pedido creado y pagado debe pasar de `pending` a `paid` en la pantalla sin recargar. Comprueba además que un `publicToken` inventado da 404 y no revela si existe o no.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): live order status for the diner"
```

---

### Task 6: Extras en el carrito y limpieza de pendientes

Deuda declarada en la fase A.

**Files:**
- Modify: `apps/web/app/m/[token]/page.tsx`, `CartClient.tsx`, `packages/db/src/orders.ts`, `packages/db/src/menu.ts`
- Create: `supabase/migrations/20260721000008_expire_pending_orders.sql`

- [ ] **Step 1: Extras en la carta**

`loadTableMenu` devuelve también los `product_extras` de cada producto. `CartClient` permite elegirlos, y `createPendingOrder` ya acepta `extraIds`: hay que persistirlos en `order_item_extras` con su `name_snapshot` y precio congelados, y sumarlos al total mediante `lineTotal`, que ya los contempla.

Test de integración: un pedido con extras cobra el precio del producto más el de los extras, leído de la base de datos, ignorando cualquier precio que venga del cliente.

- [ ] **Step 2: Caducar pedidos pendientes**

Un pedido `pending` que nunca se paga se queda para siempre. Añade una función que los marque `cancelled` pasado un plazo, y ejecútala desde `pg_cron` si está disponible en el stack local; si no, deja la función lista y documenta que el disparador llega con el despliegue.

No borres: marca. El histórico de intentos de pedido es información útil, y borrar filas que el personal pudo haber visto es peor que conservarlas.

- [ ] **Step 3: Verificar y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`

```bash
git add apps/web packages/db supabase/migrations/20260721000008_expire_pending_orders.sql tests
git commit -m "feat(web): product extras and expiry of abandoned pending orders"
```

---

## Criterio de aceptación de la fase B

```
pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e
```

Más la demostración manual que da nombre a la fase: pagar un pedido desde un navegador y verlo aparecer solo, sin recargar, en el panel de otro.

## Verificación contra el spec

| Requisito del spec | Tarea |
|---|---|
| Panel de comandas en tiempo real, cocina y barra | 4 |
| Marcar comanda servida | 4 |
| Seguimiento del pedido para el comensal | 5 |
| Acceso del personal por local, sesión larga | 3 |
| Restricción de `memberships.role` | 1 |
| Alérgenos y extras en la carta | 6 |
| El comensal nunca habla con Supabase | 5 (sondeo) |
| RLS aplicada a los eventos de Realtime | 2 (demostrado, no supuesto) |

## Fuera de esta fase

Emparejamiento de dispositivos, descubrimiento de impresoras e impresión ESC/POS van en el plan de la fase C, que se escribirá cuando ésta esté cerrada.
