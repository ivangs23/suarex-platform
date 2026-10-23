# Panel de admin — Fase D1: RLS por rol y CRUD de catálogo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un `owner` gestiona la carta entera de su restaurante desde un panel de administración; un `staff` es rechazado en cada intento de gestión, por la interfaz y llamando a la acción directamente, y sigue pudiendo operar el panel de comandas.

**Architecture:** La RLS gana una dimensión de rol: las tablas de configuración pasan a lectura-para-el-tenant + escritura-solo-para-`owner`/`admin`, generalizando el patrón que ya acotó al rol `device`. Toda escritura de gestión pasa por una Server Action que comprueba el rol del claim del JWT antes de tocar nada, con el service role; la RLS es la segunda barrera. Las imágenes se suben por el servidor a Supabase Storage, nunca desde el navegador.

**Tech Stack:** Next 16 App Router (Server Actions), Supabase (RLS + Storage), `@supabase/ssr`, TypeScript strict, Vitest, Playwright, Biome.

## Global Constraints

- Directorio único: `/Users/ivangonzalez/Documents/proyectos/suarex-platform`. **Prohibido escribir en** `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2`, `web-prueba`.
- Prohibido conectar o aplicar migraciones a los proyectos Supabase de producción. Solo el stack local. Nunca `supabase link`.
- Ninguna policy RLS puede ser `USING (true)`. Las formas permitidas viven en `tests/integration/helpers/policy-check.ts` por coincidencia exacta; una forma nueva se añade **textual y exacta**, nunca se relaja la comparación.
- El rol se lee del claim del JWT vía `public.current_tenant_role()` (ya existe, en `20260722000005_device_rls_hardening.sql`). Solo `owner`/`admin` gestionan; `staff` solo opera; `device` ya está acotado.
- Las tablas de operación (`orders`, `order_items`, `order_item_extras`) NO se tocan — `staff` debe seguir leyendo pedidos y actualizando `kitchen_status`/`bar_status`.
- `memberships` sigue sin escritura directa desde `authenticated` (bloqueado en fase B). Este plan no da de alta personal (eso es la fase D3).
- Los `allergens` globales (`tenant_id NULL`) siguen intocables por cualquier autenticado, incluido `owner`.
- Toda Server Action de gestión comprueba el rol ANTES de escribir, y escribe solo en el tenant de la sesión, nunca en un `tenantId` que venga del cliente.
- El navegador nunca habla con Supabase Storage; la subida pasa por el servidor.
- Prohibidos los literales hexadecimales de color en `apps/web` fuera del `:root` de `app/globals.css`.
- Money en céntimos enteros; los precios se muestran formateados en el borde con `formatCents`.
- TypeScript strict. Prohibido `any` explícito, `@ts-ignore`, `@ts-expect-error`.
- Ningún test se salta en una ejecución por defecto.
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:tests`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` en verde al terminar cada tarea. Tras `supabase db reset`, el orden es `pnpm db:env` → `pnpm seed:staff`; preservar las tres variables de Stripe en `apps/web/.env.local`.
- Conventional Commits. Rama `feat/qr-channel`.

---

## Estructura de ficheros

```
supabase/migrations/
  20260722000006_role_write_policies.sql    RLS por rol en tablas de configuración
  20260722000007_catalog_storage.sql        bucket de imágenes + policies de storage
packages/db/src/
  admin-catalog.ts                           NUEVO: escrituras de catálogo (service role, exigen tenantId)
  index.ts                                   MODIFICAR: exports
apps/web/
  lib/require-manager.ts                     NUEVO: guard sesión + rol owner|admin
  lib/storage.ts                             NUEVO: subida a Storage validada
  app/admin/layout.tsx                       NUEVO: layout con guard
  app/admin/page.tsx                         NUEVO: índice del panel
  app/admin/catalogo/page.tsx                NUEVO: categorías + navegación
  app/admin/catalogo/actions.ts              NUEVO: Server Actions con chequeo de rol
  app/admin/catalogo/CategoryForm.tsx        NUEVO
  app/admin/catalogo/ProductForm.tsx         NUEVO
tests/
  integration/role-write-policies.test.ts    RLS: staff no escribe config, owner sí
  integration/admin-catalog.test.ts          las acciones respetan rol y tenant
  e2e/admin-catalogo.spec.ts                 flujo de un owner
```

---

### Task 1: RLS por rol en las tablas de configuración

La tarea de seguridad de la fase. Generaliza el patrón del rol `device`: separar cada policy `for all` de las tablas de configuración en lectura (todo el tenant) + escritura (solo `owner`/`admin`).

**Files:**
- Create: `supabase/migrations/20260722000006_role_write_policies.sql`
- Modify: `tests/integration/helpers/policy-check.ts` (formas nuevas, exactas)
- Modify: `tests/integration/tenant-isolation.test.ts` (`WRITE_FIXTURES` si cambia un código de rechazo)
- Test: `tests/integration/role-write-policies.test.ts`

**Interfaces:**
- Consumes: `public.current_tenant_id()`, `public.current_tenant_role()`.
- Produces: tablas de configuración con escritura restringida a `owner`/`admin`.

- [ ] **Step 1: Escribir el test que falla**

`tests/integration/role-write-policies.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import {
  admin, createTenantFixture, deleteTenantFixture, nonce, signInAs, type TenantFixture,
} from "./helpers/tenants.js";

let tenant: TenantFixture;
let staffClient: Awaited<ReturnType<typeof signInAs>>;

beforeAll(async () => {
  tenant = await createTenantFixture(`role-${nonce()}`); // owner
  // Crea un usuario staff en el mismo tenant y devuelve su cliente autenticado.
  staffClient = await signInAs(tenant.tenantId, "staff");
});

describe("escritura de catálogo por rol", () => {
  it("un owner PUEDE crear una categoría", async () => {
    const { error } = await tenant.client
      .from("categories")
      .insert({ tenant_id: tenant.tenantId, slug: `c-${nonce()}`, name_i18n: { es: "Vinos" } });
    expect(error).toBeNull();
  });

  it("un staff NO puede crear una categoría", async () => {
    const { error } = await staffClient
      .from("categories")
      .insert({ tenant_id: tenant.tenantId, slug: `c-${nonce()}`, name_i18n: { es: "Intento" } });
    expect(error?.code).toBe("42501");
  });

  it("un staff NO puede borrar un producto", async () => {
    const { data: cat } = await admin
      .from("categories")
      .insert({ tenant_id: tenant.tenantId, slug: `c-${nonce()}`, name_i18n: { es: "X" } })
      .select("id").single();
    const { data: prod } = await admin
      .from("products")
      .insert({ tenant_id: tenant.tenantId, category_id: cat?.id, name_i18n: { es: "P" }, price: 1 })
      .select("id").single();

    const { error } = await staffClient.from("products").delete().eq("id", prod?.id);
    // RLS: 0 filas afectadas o permiso denegado; nunca borra.
    const { data: still } = await admin.from("products").select("id").eq("id", prod?.id);
    expect(still).toHaveLength(1);
  });

  it("REGRESIÓN: un staff SIGUE pudiendo marcar una comanda (opera en orders)", async () => {
    const { data: venue } = await admin
      .from("venues").insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: false })
      .select("id").single();
    const { data: order } = await admin
      .from("orders")
      .insert({ tenant_id: tenant.tenantId, venue_id: venue?.id, order_number: 1, status: "paid", kitchen_status: "pending" })
      .select("id").single();

    const { error } = await staffClient
      .from("orders").update({ kitchen_status: "done" }).eq("id", order?.id);
    expect(error).toBeNull();
  });

  it("un owner NO puede modificar un alérgeno global de la UE", async () => {
    const { data: global } = await admin
      .from("allergens").select("id").is("tenant_id", null).limit(1).single();
    const { error } = await tenant.client
      .from("allergens").update({ icon: "hackeado" }).eq("id", global?.id);
    // El predicado tenant_id = current_tenant_id() excluye los NULL globales.
    const { data: intact } = await admin.from("allergens").select("icon").eq("id", global?.id).single();
    expect(intact?.icon).not.toBe("hackeado");
  });
});
```

Nota para quien implemente: si `tests/integration/helpers/tenants.ts` no exporta `signInAs(tenantId, role)`, añádelo — crea un usuario de Auth, le da una `membership` con ese rol vía el service role, y devuelve un cliente firmado. Es aditivo; sigue el patrón de `createTenantFixture` (que crea al `owner`). Recuerda limpiar sus usuarios en el `afterAll` del fichero, acotado a los que este fichero crea (ver el gotcha de higiene registrado).

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm test:integration -- tests/integration/role-write-policies.test.ts`
Expected: FAIL. Hoy `staff` puede crear/borrar catálogo: las policies son `for all`.

- [ ] **Step 3: Escribir la migración**

`supabase/migrations/20260722000006_role_write_policies.sql`:
```sql
-- Segunda RLS por rol del esquema, tras el rol `device` (000005). Las tablas de
-- CONFIGURACIÓN pasan a: lectura para todo el tenant, escritura solo para
-- owner/admin. Las tablas de OPERACIÓN (orders, order_items, order_item_extras)
-- NO se tocan: staff sigue operando el panel de comandas.
--
-- Patrón por tabla: se elimina la policy `for all` y se crea una de SELECT (todo
-- el tenant) y una de escritura (owner/admin). El predicado de tenant se conserva
-- exactamente; solo se AÑADE la condición de rol en el lado de escritura.

-- ---- categories ----
drop policy categories_isolation on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy categories_write on public.categories
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- products ----
drop policy products_isolation on public.products;
create policy products_select on public.products
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy products_write on public.products
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- product_extras ----
drop policy product_extras_isolation on public.product_extras;
create policy product_extras_select on public.product_extras
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy product_extras_write on public.product_extras
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- allergens ----
-- Ojo: la lectura ya admite los globales (tenant_id IS NULL). La escritura sigue
-- exigiendo tenant_id = current_tenant_id() (que excluye los NULL globales) MÁS
-- el rol. Los 14 de la UE quedan intocables por cualquier autenticado.
drop policy allergens_read on public.allergens;
drop policy allergens_write on public.allergens;
create policy allergens_select on public.allergens
  for select to authenticated
  using (tenant_id is null or tenant_id = public.current_tenant_id());
create policy allergens_write on public.allergens
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- tables ----
drop policy tables_isolation on public.tables;
create policy tables_select on public.tables
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy tables_write on public.tables
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- venues ----
drop policy venues_isolation on public.venues;
create policy venues_select on public.venues
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy venues_write on public.venues
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- tenant_settings ----
-- OJO: esta tabla NO tiene una policy `_isolation`. Ya está separada por comando
-- en cuatro: tenant_settings_select / _insert / _update / _delete (verificado en
-- la base actual). El SELECT se deja intacto; se recrean las tres de escritura
-- añadiendo el rol. Confirma los nombres exactos con
--   select policyname, cmd from pg_policies where tablename='tenant_settings';
-- antes de dropear, por si una migración posterior los cambió.
drop policy tenant_settings_insert on public.tenant_settings;
drop policy tenant_settings_update on public.tenant_settings;
drop policy tenant_settings_delete on public.tenant_settings;
create policy tenant_settings_write on public.tenant_settings
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));
```

Nota: `devices` y `printers` NO se tocan aquí — su escritura ya está gobernada por las policies del rol `device` (000005), que además son gestionables por owner/admin en la fase D2. Confirma en 000005 su forma actual antes de asumir nada; si su escritura sigue siendo `for all` para no-device, la restricción de rol de gestión se añade en D2, no aquí. `memberships` tampoco: sigue sin escritura autenticada.

- [ ] **Step 4: Aplicar y añadir las formas al allowlist**

Run: `supabase db reset && pnpm db:env && pnpm seed:staff && pnpm test:integration`
Expected: FALLA en la suite anti-fuga (`tenant-isolation.test.ts`): las policies de escritura tienen una forma nueva (`... and current_tenant_role() in (...)`) que no está en el allowlist.

Consulta la forma canónica EXACTA que Postgres renderiza:
```bash
docker exec -i "$(docker ps --filter name=supabase_db_suarex --format '{{.Names}}' | head -1)" \
  psql -U postgres -d postgres -tAc "select qual from pg_policies where tablename='categories' and policyname='categories_write';"
```
Añade esa cadena EXACTA como una forma permitida nueva en `policy-check.ts`, siguiendo cómo están declaradas las demás (por `cmd` y `clause`). La forma de escritura por rol es común a todas las tablas de este cambio, así que probablemente sea una sola entrada nueva, no una por tabla — verifícalo comparando el `qual` de dos tablas. La forma de SELECT (`tenant_id = current_tenant_id()`) ya está permitida. La de `allergens_select` (`tenant_id is null or ...`) ya está permitida desde el sub-proyecto 1.

Nunca relajes la comparación. Si dudas de si una forma es demasiado permisiva, recuerda que el allowlist es de coincidencia exacta: una policy degradada a `using (true)` no coincidiría con ninguna forma y rompería el build — que es lo correcto.

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm test:integration`
Expected: PASS, incluida `role-write-policies.test.ts` y la anti-fuga.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260722000006_role_write_policies.sql tests/integration/helpers/policy-check.ts tests/integration/helpers/tenants.ts tests/integration/role-write-policies.test.ts tests/integration/tenant-isolation.test.ts
git commit -m "feat(db): restrict config-table writes to owner/admin roles"
```

---

### Task 2: El guard del panel — sesión + rol de gestión

**Files:**
- Create: `apps/web/lib/require-manager.ts`
- Create: `apps/web/app/admin/layout.tsx`, `apps/web/app/admin/page.tsx`
- Modify: `apps/web/lib/staff-session.ts` (exponer el rol en la sesión)

**Interfaces:**
- Consumes: `resolveStaffSession(client, hostTenant, jwt?)` → `{ userId, tenantId } | null`; `requireTenant()`.
- Produces:
  - `type ManagerSession = { userId: string; tenantId: string; role: "owner" | "admin" }`
  - `requireManager(): Promise<ManagerSession>` — resuelve la sesión, exige rol `owner`/`admin`, o `redirect("/staff/login")`

- [ ] **Step 1: Exponer el rol en la sesión**

`resolveStaffSession` hoy devuelve `{ userId, tenantId }`. El rol vive en el claim `tenant_role`. Amplía `StaffSession` para incluirlo, leyéndolo del mismo `claims`:

En `apps/web/lib/staff-session.ts`, dentro de `resolveStaffSession`, tras validar `tenantId` y `userId`:
```ts
  const role = claims.tenant_role;
  const validRoles = ["owner", "admin", "staff", "device"] as const;
  if (typeof role !== "string" || !validRoles.includes(role as (typeof validRoles)[number])) {
    return null;
  }

  return { userId, tenantId, role: role as (typeof validRoles)[number] };
```
Y amplía el tipo `StaffSession` a `{ userId: string; tenantId: string; role: "owner" | "admin" | "staff" | "device" }`. Esto es aditivo: el panel de comandas (fase B) que consume `{ userId, tenantId }` no se rompe.

- [ ] **Step 2: Escribir el test del guard**

Como `requireManager` usa `redirect` de Next (que lanza), la forma más limpia de probar su lógica es un test e2e (Task 5). Aquí, un test unitario de la decisión de rol, extrayendo la comprobación pura:

`apps/web/lib/require-manager.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isManagerRole } from "./require-manager.js";

describe("isManagerRole", () => {
  it("owner y admin gestionan", () => {
    expect(isManagerRole("owner")).toBe(true);
    expect(isManagerRole("admin")).toBe(true);
  });
  it("staff y device no gestionan", () => {
    expect(isManagerRole("staff")).toBe(false);
    expect(isManagerRole("device")).toBe(false);
  });
});
```

Nota: `apps/web` necesita una `vitest.config.ts` propia si no la tiene, o el test debe correr bajo el runner de la app. Comprueba cómo corren hoy los tests de `apps/web` (`staff-session.test.ts`, `staff-order-input.test.ts` existen) y sigue ese patrón.

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: el comando de test unitario de `apps/web` (el mismo con el que corren `staff-session.test.ts`)
Expected: FAIL — `isManagerRole` no existe.

- [ ] **Step 4: Implementar el guard**

`apps/web/lib/require-manager.ts`:
```ts
import { redirect } from "next/navigation";
import { resolveStaffSession } from "./staff-session";
import { staffServerClient } from "./supabase-server";
import { requireTenant } from "./tenant-context";

export type ManagerRole = "owner" | "admin";
export type ManagerSession = { userId: string; tenantId: string; role: ManagerRole };

export function isManagerRole(role: string): role is ManagerRole {
  return role === "owner" || role === "admin";
}

/**
 * Guard del panel de administración. Devuelve la sesión SOLO si el usuario está
 * autenticado para el tenant resuelto por Host Y su rol es owner/admin. En
 * cualquier otro caso redirige a /staff/login -- mismo destino indistinguible
 * para "no autenticado", "otro tenant" y "staff sin permisos de gestión", para
 * no revelar cuál de los tres es. La comprobación de rol aquí es la primera
 * barrera; la RLS es la segunda.
 */
export async function requireManager(): Promise<ManagerSession> {
  const tenant = await requireTenant();
  const client = await staffServerClient();
  const session = await resolveStaffSession(client, { id: tenant.id, slug: tenant.slug });

  if (!session || !isManagerRole(session.role)) {
    redirect("/staff/login");
  }

  return { userId: session.userId, tenantId: session.tenantId, role: session.role };
}
```

Nota para quien implemente: confirma la firma real de `staffServerClient()` y `requireTenant()` en `apps/web/lib/`. Si `resolveStaffSession` espera otra forma de `hostTenant`, adáptate a la real.

`apps/web/app/admin/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import { requireManager } from "@/lib/require-manager";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireManager(); // redirige si no es gestor; nada se renderiza para un staff
  return (
    <div>
      <nav>
        <a href="/admin">Inicio</a> · <a href="/admin/catalogo">Catálogo</a>
      </nav>
      {children}
    </div>
  );
}
```

`apps/web/app/admin/page.tsx`:
```tsx
export default function AdminHome() {
  return (
    <main>
      <h1>Panel de administración</h1>
      <p>Gestiona la carta de tu restaurante.</p>
    </main>
  );
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: el test unitario de `apps/web`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/require-manager.ts apps/web/lib/require-manager.test.ts apps/web/lib/staff-session.ts apps/web/app/admin
git commit -m "feat(web): admin panel guard requiring owner/admin role"
```

---

### Task 3: Storage de imágenes — bucket, policies y subida por servidor

**Files:**
- Create: `supabase/migrations/20260722000007_catalog_storage.sql`
- Create: `apps/web/lib/storage.ts`
- Test: `tests/integration/catalog-storage.test.ts`

**Interfaces:**
- Consumes: el service role de `@suarex/db` (a través de un accesor nuevo y estrecho) o el cliente de Storage con service role en el servidor.
- Produces:
  - `uploadProductImage(tenantId: string, file: { bytes: Uint8Array; contentType: string }): Promise<string>` — sube a `tenant/{tenantId}/products/{uuid}`, devuelve la ruta pública; valida tipo y tamaño

- [ ] **Step 1: Escribir la migración del bucket**

`supabase/migrations/20260722000007_catalog_storage.sql`:
```sql
-- Bucket de imágenes de catálogo. Público en LECTURA (las fotos de la carta las
-- ve cualquier comensal), pero la ESCRITURA solo por el servidor con service
-- role: el navegador nunca sube directamente. Las rutas son tenant/{id}/... así
-- que un objeto pertenece siempre a un tenant identificable.
insert into storage.buckets (id, name, public)
values ('catalog', 'catalog', true)
on conflict (id) do nothing;

-- Sin policies de INSERT/UPDATE/DELETE para anon/authenticated: solo el service
-- role (que las salta) escribe. La lectura pública la da `public = true`.
```

- [ ] **Step 2: Escribir el test de subida**

`tests/integration/catalog-storage.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { uploadProductImage } from "../../apps/web/lib/storage.js";
import { admin, nonce } from "./helpers/tenants.js";

// PNG 1x1 mínimo válido.
const PNG_1x1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

describe("uploadProductImage", () => {
  it("sube un PNG y devuelve una ruta bajo el tenant", async () => {
    const tenantId = nonce();
    const path = await uploadProductImage(tenantId, { bytes: PNG_1x1, contentType: "image/png" });
    expect(path).toContain(`tenant/${tenantId}/products/`);

    // El objeto existe en el bucket.
    const { data } = await admin.storage.from("catalog").list(`tenant/${tenantId}/products`);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("rechaza un tipo no permitido", async () => {
    await expect(
      uploadProductImage(nonce(), { bytes: PNG_1x1, contentType: "application/pdf" }),
    ).rejects.toThrow(/tipo/i);
  });

  it("rechaza un fichero demasiado grande", async () => {
    const big = new Uint8Array(6 * 1024 * 1024); // 6 MB
    await expect(
      uploadProductImage(nonce(), { bytes: big, contentType: "image/png" }),
    ).rejects.toThrow(/tama/i);
  });
});
```

Nota: si `apps/web/lib/storage.ts` importa `@supabase/supabase-js` directamente, choca con la regla de biome (solo `packages/db`). Dos opciones: (a) el helper vive en `packages/db` como `uploadProductImage` reutilizando el service client interno, y `apps/web` lo consume; (b) añades `apps/web/lib/storage.ts` a la excepción del biome con justificación. La opción (a) es más coherente con la arquitectura (solo `packages/db` toca Supabase) — préfierela y ajusta el import del test.

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `supabase db reset && pnpm db:env && pnpm seed:staff && pnpm test:integration -- tests/integration/catalog-storage.test.ts`
Expected: FAIL — `uploadProductImage` no existe.

- [ ] **Step 4: Implementar la subida**

En `packages/db/src/admin-catalog.ts` (o un `storage.ts` en `packages/db`), con el service client interno:
```ts
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadProductImage(
  tenantId: string,
  file: { bytes: Uint8Array; contentType: string },
): Promise<string> {
  if (!ALLOWED_TYPES.has(file.contentType)) {
    throw new Error(`Tipo de imagen no permitido: ${file.contentType}`);
  }
  if (file.bytes.byteLength > MAX_BYTES) {
    throw new Error(`Imagen demasiado grande: ${file.bytes.byteLength} bytes (máx ${MAX_BYTES})`);
  }

  const ext = file.contentType === "image/png" ? "png" : file.contentType === "image/webp" ? "webp" : "jpg";
  const path = `tenant/${tenantId}/products/${crypto.randomUUID()}.${ext}`;

  const { error } = await storageServiceClient()
    .storage.from("catalog")
    .upload(path, file.bytes, { contentType: file.contentType, upsert: false });
  if (error) throw error;

  return path;
}
```

Añade `storageServiceClient()` en `packages/db/src/client.ts` como accesor estrecho documentado (mismo patrón que los demás), o reutiliza el `serviceClient` interno para `.storage`. No exportes el cliente crudo.

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm test:integration -- tests/integration/catalog-storage.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260722000007_catalog_storage.sql packages/db tests/integration/catalog-storage.test.ts
git commit -m "feat(db): server-side product image upload to tenant-scoped storage"
```

---

### Task 4: Repositorios y Server Actions de catálogo, con chequeo de rol

**Files:**
- Create: `packages/db/src/admin-catalog.ts` (repositorios); Modify: `packages/db/src/index.ts`
- Create: `apps/web/app/admin/catalogo/actions.ts` (Server Actions)
- Test: `tests/integration/admin-catalog.test.ts`

**Interfaces:**
- Consumes: `tenantScoped` (obligatorio `tenantId`); `requireManager()` (Task 2); `uploadProductImage` (Task 3).
- Produces (repositorios, todos exigen `tenantId` explícito, todos vía `tenantScoped`):
  - `createCategory`, `updateCategory`, `deleteCategory`
  - `createProduct`, `updateProduct`, `deleteProduct`, `setProductAvailability`
  - `createExtra`, `deleteExtra`
  - `createTenantAllergen`, `deleteTenantAllergen`
  - `listAdminCatalog(tenantId)` → categorías + productos + extras + alérgenos del tenant, para las pantallas
- Produces (Server Actions, cada una llama `requireManager()` primero y usa `session.tenantId`, nunca un tenant del cliente):
  - `createCategoryAction(formData)`, etc.

- [ ] **Step 1: Escribir el test de repositorios + autorización**

`tests/integration/admin-catalog.test.ts` cubre, contra la base local:
- `createCategory(tenantId, {...})` crea la fila; `listAdminCatalog(tenantId)` la devuelve.
- Un producto creado con `createProduct` lleva su `category_id`, precio y (si se da) `image_path`.
- **Aislamiento**: `createProduct` con una `categoryId` de otro tenant es rechazado (el trigger `assert_same_tenant` o el filtro de `tenantScoped`).
- El repositorio nunca escribe en un tenant distinto del `tenantId` que recibe.

Los repositorios usan el service role (saltan RLS), así que la comprobación de rol NO vive en ellos — vive en la Server Action. Aun así, el aislamiento por tenant es del repositorio y se prueba aquí. La comprobación de rol de la Server Action se prueba en el e2e (Task 5), donde hay sesión real.

- [ ] **Step 2 → 4: Implementar repositorios y acciones (TDD)**

Los repositorios en `packages/db/src/admin-catalog.ts` son `tenantScoped(...).insert/update/delete` con `tenantId` obligatorio, siguiendo exactamente el patrón de `orders.ts`/`staff-orders.ts` ya en el repo. `listAdminCatalog` es un `select` acotado con los embeds de categoría→productos→extras.

Las Server Actions en `apps/web/app/admin/catalogo/actions.ts` tienen todas esta forma, que es el control de seguridad de la fase:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { createCategory, uploadProductImage, createProduct } from "@suarex/db";
import { requireManager } from "@/lib/require-manager";

export async function createCategoryAction(formData: FormData): Promise<void> {
  const session = await requireManager(); // rechaza a staff/device y a otro tenant
  const slug = String(formData.get("slug") ?? "").trim();
  const nameEs = String(formData.get("name_es") ?? "").trim();
  if (!slug || !nameEs) throw new Error("Faltan campos obligatorios");

  await createCategory(session.tenantId, {
    slug,
    nameI18n: { es: nameEs },
    destination: formData.get("destination") === "barra" ? "barra" : "cocina",
  });
  revalidatePath("/admin/catalogo");
}
```
El `tenantId` SIEMPRE sale de `session`, NUNCA de `formData`. Un `staff` que haga POST a la acción directamente es rechazado por `requireManager` antes de que se escriba nada. La acción de producto adicionalmente valida y sube la imagen con `uploadProductImage(session.tenantId, ...)` si viene un fichero.

- [ ] **Step 5: Verificar y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`

```bash
git add packages/db apps/web/app/admin/catalogo/actions.ts tests/integration/admin-catalog.test.ts
git commit -m "feat: catalog repositories and role-checked server actions"
```

---

### Task 5: Pantallas de gestión de catálogo y e2e

**Files:**
- Create: `apps/web/app/admin/catalogo/page.tsx`, `CategoryForm.tsx`, `ProductForm.tsx`
- Test: `tests/e2e/admin-catalogo.spec.ts`

**Interfaces:**
- Consumes: `requireManager`, `listAdminCatalog`, y las Server Actions (Task 4).
- Produces: las pantallas funcionales del catálogo.

- [ ] **Step 1: Escribir el e2e que falla**

`tests/e2e/admin-catalogo.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

const STAFF_PASSWORD = process.env.STAFF_SEED_PASSWORD;
test.skip(!STAFF_PASSWORD, "Falta STAFF_SEED_PASSWORD (ver README, gotcha de setup)");

// El personal demo sembrado por `pnpm seed:staff` tiene rol 'staff'. Para el
// panel de admin hace falta un owner; el seed debe crear también un owner demo,
// o este test lo crea vía la API de admin en un beforeAll. Ver nota abajo.

test("un staff no ve el panel de gestión", async ({ page }) => {
  await page.goto("http://garum.localhost:3000/staff/login");
  await page.getByLabel("Email", { exact: true }).fill("staff@garum.local");
  await page.getByLabel("Contraseña", { exact: true }).fill(STAFF_PASSWORD as string);
  await page.getByRole("button", { name: "Entrar" }).click();

  const response = await page.goto("http://garum.localhost:3000/admin/catalogo");
  // Redirigido al login de staff: el guard rechaza a un staff.
  await expect(page).toHaveURL(/\/staff\/login/);
});

test("un owner crea una categoría y un producto, y aparecen en la carta", async ({ page }) => {
  // login como owner demo (ver nota)…
  // crea categoría "Vinos" (destino barra)
  // crea producto "Ribera" 18,00 € en esa categoría
  // navega a la carta pública /m/{token} y comprueba que "Ribera" aparece
});
```

Nota para quien implemente: hace falta un usuario `owner` demo. El seed actual (`seed:staff`) crea rol `staff`. Amplía `scripts/seed-staff.mjs` (o un `seed:owner`) para sembrar también `owner@garum.local` con rol `owner`, con la misma contraseña generada, y documéntalo. No hardcodees la contraseña. El test de "owner crea…" se completa con ese usuario.

- [ ] **Step 2 → 4: Implementar las pantallas (TDD)**

`app/admin/catalogo/page.tsx` (servidor): `requireManager()`, `listAdminCatalog(session.tenantId)`, y renderiza las categorías con sus productos, más `CategoryForm` y `ProductForm`.

`CategoryForm.tsx`: un formulario con `action={createCategoryAction}` y campos `slug`, `name_es`, `destination` (cocina/barra). Sin estilos más allá de lo funcional; los precios y textos usan las variables CSS del tenant.

`ProductForm.tsx`: formulario con `action={createProductAction}`, campos `name_es`, `description_es`, `price` (en euros, se convierte a céntimos en la acción con `eurosToCents`), `category_id` (select de las categorías del tenant), `image` (input file, opcional), y los alérgenos (checkboxes). La imagen se envía en el `FormData` y la Server Action la sube con `uploadProductImage`.

Las pantallas de extras y alérgenos siguen el MISMO patrón que `CategoryForm` (formulario → Server Action con `requireManager` → repositorio `tenantScoped`), con estos campos: extras = `name_es` + `price` + `product_id`; alérgenos propios = `name_es` + `icon`. No requieren diseño distinto; añádelas como formularios equivalentes en la misma página o en subrutas `catalogo/extras` y `catalogo/alergenos`.

- [ ] **Step 5: Criterio de aceptación de la fase D1**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`
Expected: todo verde, cero saltados.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/admin/catalogo tests/e2e/admin-catalogo.spec.ts scripts/seed-staff.mjs
git commit -m "feat(web): catalog management screens and owner e2e"
```

---

## Verificación contra el spec

| Requisito del spec (D1) | Tarea |
|---|---|
| RLS por rol en tablas de configuración | 1 |
| `staff` conserva la operación (panel de comandas) | 1 (regresión) |
| Alérgenos globales intocables | 1 |
| Guard del panel: solo owner/admin | 2 |
| Subida de imágenes por servidor a Storage | 3 |
| Repositorios de catálogo acotados por tenant | 4 |
| Server Actions con chequeo de rol antes de escribir | 4 |
| Pantallas de gestión de la carta | 5 |
| Un owner gestiona, un staff no | 5 (e2e) |
| Anti-fuga sobre las policies nuevas | 1 (automática) |

## Fuera de la fase D1

Mesas, QRs, dispositivos, impresoras (fase D2). Ajustes del negocio y alta de personal (fase D3). El diseño visual del panel (paso posterior, con la skill de diseño).

## Deuda consciente de esta fase

- El borrado de una categoría se lleva en cascada sus productos (deuda registrada desde la fundación). La pantalla debe avisar antes de confirmar; el aviso de UI es funcional, no bonito.
- El seed de un `owner` demo se añade para el e2e; en producción los owners se crean en el alta del tenant (sub-proyecto de billing/onboarding).
