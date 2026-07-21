# Canal QR — Fase A: el pedido existe y está cobrado

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un comensal escanea el QR de su mesa, compone un pedido desde el móvil, paga con tarjeta, y el pedido queda registrado como pagado con sus líneas y su número correlativo del día.

**Architecture:** El pedido se crea en estado `pending` antes de cobrar, para que el webhook de Stripe pueda encontrarlo por `stripe_payment_intent_id`. El servidor recalcula todos los importes leyendo precios de la base de datos: el navegador solo dice *qué* se pide, nunca *cuánto* cuesta. El webhook es la única vía que marca un pedido como pagado. Los cálculos monetarios viven en un paquete puro (`@suarex/domain`) que trabaja en céntimos enteros.

**Tech Stack:** pnpm + Turborepo, TypeScript strict, Next 16 App Router, Supabase (stack local), Stripe (modo test) con `stripe` y `@stripe/react-stripe-js`, Vitest, Playwright, Biome.

## Global Constraints

- Directorio de trabajo único: `/Users/ivangonzalez/Documents/proyectos/suarex-platform`. **Prohibido escribir en** `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2`, `web-prueba`.
- Prohibido conectar o aplicar migraciones a los proyectos Supabase de producción. Solo el stack local de Supabase CLI. Nunca `supabase link`.
- Ninguna policy RLS puede ser `USING (true)`. Las formas permitidas se declaran en `tests/integration/helpers/policy-check.ts` mediante coincidencia exacta; una tabla nueva con una forma no declarada **debe** romper el build, y la respuesta correcta es añadir la forma exacta, nunca relajar la comprobación.
- Toda tabla de dominio lleva `tenant_id uuid not null` con índice. Toda clave única de negocio se compone con `tenant_id`.
- La función de tenant se llama `public.current_tenant_id()`.
- Textos multiidioma en `jsonb` con forma `{"es": "...", "en": "..."}`. Prohibidas columnas `name_en` / `name_pt`.
- Solo `packages/db` puede importar `@supabase/supabase-js`. Dentro de `packages/db`, solo `src/client.ts` puede llamar al cliente sin filtro.
- Los componentes usan exclusivamente variables CSS. Prohibidos los literales hexadecimales de color en `apps/web` fuera del bloque `:root` de `app/globals.css`.
- **Los precios de carta llevan el IVA incluido** (norma española). El total es la suma de las líneas; la base imponible se obtiene dividiendo por `1 + tipo`, no multiplicando.
- Todo cálculo monetario se hace en **céntimos enteros**. Prohibido operar con euros en coma flotante.
- TypeScript strict. Prohibido `any` explícito, `@ts-ignore` y `@ts-expect-error`.
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:tests`, `pnpm test`, `pnpm test:integration` y `pnpm test:e2e` deben estar en verde al terminar cada tarea.
- Mensajes de commit en formato Conventional Commits.

---

## Estructura de ficheros

```
packages/
  domain/                          @suarex/domain — NUEVO, lógica pura sin I/O
    src/money.ts                   céntimos: parseo, suma, formateo
    src/pricing.ts                 líneas, total, desglose de IVA incluido
    src/index.ts
  db/
    src/client.ts                  MODIFICAR: tenantScoped gana insert/update
    src/tables.ts                  NUEVO: findTableByToken
    src/orders.ts                  NUEVO: createPendingOrder, markOrderPaid, getOrderByPublicToken
    src/types.ts                   MODIFICAR: tipos de mesa y pedido
    src/index.ts                   MODIFICAR: nuevos exports
apps/web/
  app/m/[token]/page.tsx           NUEVO: carta de la mesa
  app/m/[token]/CartClient.tsx     NUEVO: carrito y checkout (cliente)
  app/api/orders/route.ts          NUEVO: crea pedido pending + PaymentIntent
  app/api/webhook/stripe/route.ts  NUEVO: única vía que marca pagado
  lib/stripe.ts                    NUEVO: cliente de Stripe en servidor
supabase/migrations/
  20260721000004_tables.sql        mesas + contador de pedidos
  20260721000005_orders.sql        pedidos, líneas y extras
tests/
  integration/orders.test.ts       recálculo de importes, idempotencia, contador
  e2e/qr-order.spec.ts             flujo completo con tarjeta de prueba
```

---

### Task 1: `tenantScoped` gana escrituras acotadas

Hoy `tenantScoped` solo expone `select`. Crear pedidos exige `insert` y `update`, y deben ser igual de imposibles de usar mal.

**Files:**
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/__compile_fixtures__/no-tenant-filter.fixture.ts`
- Test: `tests/integration/tenant-filter-structural.test.ts`

**Interfaces:**
- Consumes: `tenantScoped(table, tenantId)` con `.select(columns)`.
- Produces:
  - `tenantScoped(table, tenantId).insert<Row>(rows: Row | Row[])` — inyecta `tenant_id` en cada fila, ignorando cualquier `tenant_id` que traigan
  - `tenantScoped(table, tenantId).update(values)` — devuelve un builder ya filtrado por `tenant_id`
  - `TenantScopedTable` amplía la unión con `"tables" | "orders" | "order_items" | "order_item_extras"`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/integration/tenant-filter-structural.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tenantScoped } from "@suarex/db/client";
import { admin, createTenantFixture, deleteTenantFixture } from "./helpers/tenants.js";

describe("tenantScoped.insert", () => {
  it("ignora un tenant_id ajeno que venga en la fila", async () => {
    const a = await createTenantFixture(`ins-a-${Date.now()}`);
    const b = await createTenantFixture(`ins-b-${Date.now()}`);

    await tenantScoped("categories", a.tenantId).insert({
      tenant_id: b.tenantId,
      slug: "intento",
      name_i18n: { es: "Intento" },
    });

    const { data } = await admin
      .from("categories")
      .select("tenant_id")
      .eq("slug", "intento");

    expect(data).toHaveLength(1);
    expect(data?.[0]?.tenant_id).toBe(a.tenantId);

    await admin.from("categories").delete().eq("slug", "intento");
    await deleteTenantFixture(a);
    await deleteTenantFixture(b);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm test:integration -- tests/integration/tenant-filter-structural.test.ts`
Expected: FAIL — `tenantScoped(...).insert is not a function`

- [ ] **Step 3: Implementar**

En `packages/db/src/client.ts`, ampliar la unión y el objeto devuelto:

```ts
export type TenantScopedTable =
  | "venues"
  | "tenant_settings"
  | "memberships"
  | "allergens"
  | "categories"
  | "products"
  | "product_extras"
  | "tables"
  | "orders"
  | "order_items"
  | "order_item_extras";

export function tenantScoped(table: TenantScopedTable, tenantId: string) {
  return {
    select<Query extends string = "*">(columns: Query) {
      return serviceClient().from(table).select(columns).eq("tenant_id", tenantId);
    },

    /**
     * `tenant_id` se sobreescribe DESPUÉS de esparcir la fila, así que un
     * `tenant_id` ajeno que venga en los datos no puede colarse: el del
     * parámetro siempre gana.
     */
    insert<Row extends Record<string, unknown>>(rows: Row | Row[]) {
      const list = Array.isArray(rows) ? rows : [rows];
      const scoped = list.map((row) => ({ ...row, tenant_id: tenantId }));
      return serviceClient().from(table).insert(scoped);
    },

    /**
     * `tenant_id` se elimina de los valores (no tiene sentido reasignar una fila
     * a otro tenant) y el filtro se aplica antes de devolver el builder.
     */
    update(values: Record<string, unknown>) {
      const { tenant_id: _ignored, ...rest } = values;
      return serviceClient().from(table).update(rest).eq("tenant_id", tenantId);
    },
  };
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pnpm test:integration -- tests/integration/tenant-filter-structural.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/client.ts tests/integration/tenant-filter-structural.test.ts
git commit -m "feat(db): tenant-scoped inserts and updates"
```

---

### Task 2: Mesas y contador de pedidos

**Files:**
- Create: `supabase/migrations/20260721000004_tables.sql`
- Modify: `tests/integration/helpers/policy-check.ts` (formas permitidas)
- Modify: `tests/integration/tenant-isolation.test.ts` (`WRITE_FIXTURES`)

**Interfaces:**
- Consumes: `public.tenants`, `public.venues`, `public.current_tenant_id()`.
- Produces: tablas `public.tables`, `public.order_counters`; función `public.next_order_number(p_tenant_id uuid, p_venue_id uuid) returns int`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/20260721000004_tables.sql`:

```sql
create table public.tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  label text not null,
  token uuid not null default gen_random_uuid(),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, venue_id, label)
);
create index tables_tenant_id_idx on public.tables (tenant_id);
create unique index tables_token_idx on public.tables (token);

create table public.order_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  date date not null,
  last_number int not null default 0,
  primary key (tenant_id, venue_id, date)
);

-- Atómica: el `on conflict do update` incrementa y devuelve en una sola sentencia,
-- así que dos pedidos simultáneos nunca reciben el mismo número.
create or replace function public.next_order_number(p_tenant_id uuid, p_venue_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_num int;
begin
  insert into public.order_counters (tenant_id, venue_id, date, last_number)
  values (p_tenant_id, p_venue_id, current_date, 1)
  on conflict (tenant_id, venue_id, date)
  do update set last_number = public.order_counters.last_number + 1
  returning last_number into next_num;

  return next_num;
end;
$$;

revoke execute on function public.next_order_number (uuid, uuid) from anon, authenticated, public;
grant execute on function public.next_order_number (uuid, uuid) to service_role;

alter table public.tables enable row level security;
alter table public.order_counters enable row level security;

create policy tables_isolation on public.tables
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy order_counters_isolation on public.order_counters
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

revoke all on public.tables, public.order_counters from anon;
```

- [ ] **Step 2: Aplicar y ver fallar la suite anti-fuga**

Run: `supabase db reset && pnpm db:env && pnpm test:integration`
Expected: FAIL. Las tablas nuevas se descubren solas y no tienen entrada en `WRITE_FIXTURES`, así que el guard salta nombrándolas. Esto es lo correcto: la suite obliga a declarar la cobertura.

- [ ] **Step 3: Declarar la cobertura de escritura**

En `tests/integration/tenant-isolation.test.ts`, añadir a `WRITE_FIXTURES`:

```ts
  tables: {
    payload: (tenantId, venueId) => ({
      tenant_id: tenantId,
      venue_id: venueId,
      label: `mesa-${nonce()}`,
    }),
    updateColumn: "sort_order",
    expectedInsertRejection: { code: "42501" },
  },
  order_counters: {
    payload: (tenantId, venueId) => ({
      tenant_id: tenantId,
      venue_id: venueId,
      date: "2026-01-01",
    }),
    updateColumn: "last_number",
    expectedInsertRejection: { code: "42501" },
  },
```

Nota: si la forma de `WRITE_FIXTURES` en el fichero actual difiere de la mostrada aquí, **adáptate a la existente** y repórtalo — no reescribas la suite.

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pnpm test:integration`
Expected: PASS. Las formas de policy son las canónicas ya permitidas, así que el allowlist no necesita cambios.

- [ ] **Step 5: Verificar que el contador es atómico**

Run:
```bash
docker exec -i "$(docker ps --filter name=supabase_db_suarex --format '{{.Names}}' | head -1)" \
  psql -U postgres -d postgres -c "
    with t as (insert into tenants (slug, name) values ('cnt-test','C') returning id),
         v as (insert into venues (tenant_id, slug, name, is_default)
               select id, 'p', 'P', true from t returning tenant_id, id)
    select public.next_order_number(v.tenant_id, v.id) from v, generate_series(1,3);
    delete from tenants where slug = 'cnt-test';"
```
Expected: tres filas con valores `1`, `2`, `3`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260721000004_tables.sql tests/integration/tenant-isolation.test.ts
git commit -m "feat(db): tables with QR tokens and atomic per-day order counter"
```

---

### Task 3: Pedidos, líneas y extras

**Files:**
- Create: `supabase/migrations/20260721000005_orders.sql`
- Modify: `tests/integration/tenant-isolation.test.ts` (`WRITE_FIXTURES`)

**Interfaces:**
- Consumes: `public.tables`, `public.products`, `public.product_extras`, `public.current_tenant_id()`.
- Produces: tablas `public.orders`, `public.order_items`, `public.order_item_extras`.

- [ ] **Step 1: Escribir la migración**

`supabase/migrations/20260721000005_orders.sql`:

```sql
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  table_id uuid references public.tables (id) on delete set null,
  order_number int not null,
  channel text not null default 'qr-mesa' check (channel in ('qr-mesa', 'kiosko')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'preparing', 'served', 'cancelled')),
  subtotal numeric(10, 2) not null default 0,
  tax_amount numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  currency text not null default 'EUR',
  stripe_payment_intent_id text unique,
  paid_at timestamptz,
  kitchen_status text not null default 'na' check (kitchen_status in ('pending', 'done', 'na')),
  bar_status text not null default 'na' check (bar_status in ('pending', 'done', 'na')),
  printed_at timestamptz,
  printed_targets jsonb not null default '{}'::jsonb,
  public_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create index orders_tenant_id_idx on public.orders (tenant_id);
create unique index orders_public_token_idx on public.orders (public_token);
-- Consulta de recuperación de la fase C: pagados y sin imprimir.
create index orders_unprinted_idx on public.orders (tenant_id, status)
  where printed_at is null;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  name_snapshot jsonb not null,
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  quantity int not null check (quantity > 0),
  line_total numeric(10, 2) not null check (line_total >= 0),
  destination text not null check (destination in ('cocina', 'barra')),
  notes text
);
create index order_items_tenant_id_idx on public.order_items (tenant_id);
create index order_items_order_id_idx on public.order_items (order_id);

create table public.order_item_extras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  extra_id uuid references public.product_extras (id) on delete set null,
  name_snapshot jsonb not null,
  price numeric(10, 2) not null check (price >= 0)
);
create index order_item_extras_tenant_id_idx on public.order_item_extras (tenant_id);

-- Mismo guard que el catálogo: una línea no puede colgar de un pedido de otro tenant.
create trigger order_items_same_tenant before insert or update on public.order_items
  for each row execute function public.assert_same_tenant();
create trigger order_item_extras_same_tenant before insert or update on public.order_item_extras
  for each row execute function public.assert_same_tenant();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_extras enable row level security;

create policy orders_isolation on public.orders
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy order_items_isolation on public.order_items
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy order_item_extras_isolation on public.order_item_extras
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

revoke all on public.orders, public.order_items, public.order_item_extras from anon;
```

- [ ] **Step 2: Extender `assert_same_tenant` para las tablas nuevas**

`public.assert_same_tenant()` ramifica por `tg_table_name` y hoy solo conoce `categories`, `products` y `product_extras`. Sin una rama nueva, `parent_tenant` queda NULL y **toda** inserción de línea sería rechazada. Añadir al final de la migración:

```sql
create or replace function public.assert_same_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_tenant uuid;
begin
  if tg_table_name = 'products' then
    select c.tenant_id into parent_tenant
      from public.categories c where c.id = new.category_id;
  elsif tg_table_name = 'product_extras' then
    select p.tenant_id into parent_tenant
      from public.products p where p.id = new.product_id;
  elsif tg_table_name = 'categories' then
    if new.parent_id is null then return new; end if;
    select c.tenant_id into parent_tenant
      from public.categories c where c.id = new.parent_id;
  elsif tg_table_name = 'order_items' then
    select o.tenant_id into parent_tenant
      from public.orders o where o.id = new.order_id;
  elsif tg_table_name = 'order_item_extras' then
    select i.tenant_id into parent_tenant
      from public.order_items i where i.id = new.order_item_id;
  else
    raise exception 'assert_same_tenant no configurado para la tabla %', tg_table_name;
  end if;

  if parent_tenant is distinct from new.tenant_id then
    raise exception 'cross-tenant reference rejected';
  end if;

  return new;
end;
$$;
```

La rama `else` que lanza es deliberada: si alguien engancha este trigger a una tabla nueva sin configurarla, el fallo es explícito en vez de silencioso.

- [ ] **Step 3: Aplicar y ver fallar la suite**

Run: `supabase db reset && pnpm db:env && pnpm test:integration`
Expected: FAIL nombrando `orders`, `order_items` y `order_item_extras` por no estar en `WRITE_FIXTURES`.

- [ ] **Step 4: Declarar la cobertura de escritura**

Añadir a `WRITE_FIXTURES` en `tests/integration/tenant-isolation.test.ts`:

```ts
  orders: {
    payload: (tenantId, venueId) => ({
      tenant_id: tenantId,
      venue_id: venueId,
      order_number: 1,
    }),
    updateColumn: "order_number",
    expectedInsertRejection: { code: "42501" },
  },
  order_items: {
    payload: (tenantId) => ({
      tenant_id: tenantId,
      order_id: null,
      name_snapshot: { es: "X" },
      unit_price: 1,
      quantity: 1,
      line_total: 1,
      destination: "cocina",
    }),
    updateColumn: "quantity",
    // Rechazado por el trigger antes de llegar al WITH CHECK de RLS.
    expectedInsertRejection: { code: "P0001" },
  },
  order_item_extras: {
    payload: (tenantId) => ({
      tenant_id: tenantId,
      order_item_id: null,
      name_snapshot: { es: "X" },
      price: 1,
    }),
    updateColumn: "price",
    expectedInsertRejection: { code: "P0001" },
  },
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm test:integration`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260721000005_orders.sql tests/integration/tenant-isolation.test.ts
git commit -m "feat(db): orders, line items and extras with price snapshots"
```

---

### Task 4: `@suarex/domain` — dinero y precios

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`
- Create: `packages/domain/src/money.ts`, `packages/domain/src/pricing.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/money.test.ts`, `packages/domain/src/pricing.test.ts`

**Interfaces:**
- Consumes: nada. Paquete puro, sin I/O.
- Produces:
  - `type Cents = number` (entero)
  - `eurosToCents(euros: number): Cents`
  - `centsToEuros(cents: Cents): number`
  - `formatCents(cents: Cents, locale: string, currency: string): string`
  - `type PricedLine = { unitPrice: Cents; quantity: number; extras: Cents[] }`
  - `lineTotal(line: PricedLine): Cents`
  - `type OrderTotals = { subtotal: Cents; taxAmount: Cents; total: Cents }`
  - `computeTotals(lines: PricedLine[], taxRate: number): OrderTotals`

- [ ] **Step 1: Crear el paquete**

`packages/domain/package.json`:
```json
{
  "name": "@suarex/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.9.3", "vitest": "^4.1.5" }
}
```

`packages/domain/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

`packages/domain/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: {} });
```

- [ ] **Step 2: Escribir los tests que fallan**

`packages/domain/src/pricing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { computeTotals, lineTotal } from "./pricing.js";

describe("lineTotal", () => {
  it("multiplica precio por cantidad", () => {
    expect(lineTotal({ unitPrice: 450, quantity: 3, extras: [] })).toBe(1350);
  });

  it("suma los extras a cada unidad", () => {
    expect(lineTotal({ unitPrice: 450, quantity: 2, extras: [150, 50] })).toBe(1300);
  });
});

describe("computeTotals", () => {
  it("trata el precio de carta como IVA incluido", () => {
    // 11,00 € con IVA del 10 %: base 10,00 €, cuota 1,00 €.
    const totals = computeTotals([{ unitPrice: 1100, quantity: 1, extras: [] }], 0.1);
    expect(totals.total).toBe(1100);
    expect(totals.subtotal).toBe(1000);
    expect(totals.taxAmount).toBe(100);
  });

  it("el desglose siempre suma exactamente el total", () => {
    // 4,50 € al 10 % no divide exacto; el redondeo no puede perder ni inventar céntimos.
    const totals = computeTotals([{ unitPrice: 450, quantity: 1, extras: [] }], 0.1);
    expect(totals.subtotal + totals.taxAmount).toBe(totals.total);
  });

  it("suma varias líneas", () => {
    const totals = computeTotals(
      [
        { unitPrice: 1800, quantity: 1, extras: [] },
        { unitPrice: 450, quantity: 2, extras: [150] },
      ],
      0.1,
    );
    expect(totals.total).toBe(1800 + 1200);
  });

  it("con tipo cero, la cuota es cero y la base es el total", () => {
    const totals = computeTotals([{ unitPrice: 1000, quantity: 1, extras: [] }], 0);
    expect(totals).toEqual({ subtotal: 1000, taxAmount: 0, total: 1000 });
  });

  it("un pedido vacío da todo a cero", () => {
    expect(computeTotals([], 0.1)).toEqual({ subtotal: 0, taxAmount: 0, total: 0 });
  });
});
```

`packages/domain/src/money.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { centsToEuros, eurosToCents } from "./money.js";

describe("eurosToCents", () => {
  it("convierte sin errores de coma flotante", () => {
    // 4.35 * 100 da 434.99999... en coma flotante; redondear es obligatorio.
    expect(eurosToCents(4.35)).toBe(435);
    expect(eurosToCents(19.99)).toBe(1999);
    expect(eurosToCents(0)).toBe(0);
  });

  it("rechaza valores no finitos o negativos", () => {
    expect(() => eurosToCents(Number.NaN)).toThrow();
    expect(() => eurosToCents(-1)).toThrow();
  });
});

describe("centsToEuros", () => {
  it("invierte la conversión", () => {
    expect(centsToEuros(435)).toBe(4.35);
  });
});
```

- [ ] **Step 3: Ejecutar y verificar que fallan**

Run: `pnpm --filter @suarex/domain test`
Expected: FAIL — `Failed to resolve import "./pricing.js"`

- [ ] **Step 4: Implementar**

`packages/domain/src/money.ts`:
```ts
export type Cents = number;

export function eurosToCents(euros: number): Cents {
  if (!Number.isFinite(euros) || euros < 0) {
    throw new Error(`Importe inválido: ${euros}`);
  }
  return Math.round(euros * 100);
}

export function centsToEuros(cents: Cents): number {
  return Math.round(cents) / 100;
}

export function formatCents(cents: Cents, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    centsToEuros(cents),
  );
}
```

`packages/domain/src/pricing.ts`:
```ts
import type { Cents } from "./money.js";

export type PricedLine = {
  unitPrice: Cents;
  quantity: number;
  extras: Cents[];
};

export type OrderTotals = {
  subtotal: Cents;
  taxAmount: Cents;
  total: Cents;
};

export function lineTotal(line: PricedLine): Cents {
  const extrasPerUnit = line.extras.reduce((sum, extra) => sum + extra, 0);
  return (line.unitPrice + extrasPerUnit) * line.quantity;
}

/**
 * Los precios de carta llevan el IVA incluido (norma española), así que el total
 * es la suma de las líneas y la base imponible se obtiene DIVIDIENDO por (1 + tipo).
 * Calcularlo al revés inflaría la cuenta un 10 %.
 *
 * La cuota se deriva restando la base al total, no redondeando por separado: así
 * base + cuota == total siempre, sin céntimos perdidos ni inventados.
 */
export function computeTotals(lines: PricedLine[], taxRate: number): OrderTotals {
  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const subtotal = Math.round(total / (1 + taxRate));
  return { subtotal, taxAmount: total - subtotal, total };
}
```

`packages/domain/src/index.ts`:
```ts
export type { Cents } from "./money.js";
export { centsToEuros, eurosToCents, formatCents } from "./money.js";
export type { OrderTotals, PricedLine } from "./pricing.js";
export { computeTotals, lineTotal } from "./pricing.js";
```

- [ ] **Step 5: Ejecutar y verificar que pasan**

Run: `pnpm install && pnpm --filter @suarex/domain test`
Expected: PASS — 10 tests

- [ ] **Step 6: Commit**

```bash
git add packages/domain pnpm-lock.yaml
git commit -m "feat(domain): integer-cent money and VAT-inclusive pricing"
```

---

### Task 5: Repositorios de mesa y pedido

**Files:**
- Create: `packages/db/src/tables.ts`, `packages/db/src/orders.ts`
- Modify: `packages/db/src/types.ts`, `packages/db/src/index.ts`, `packages/db/package.json`
- Test: `tests/integration/orders.test.ts`

**Interfaces:**
- Consumes: `tenantScoped` con `insert`/`update` (Task 1); tablas de las Tasks 2 y 3; `computeTotals`, `lineTotal` (Task 4).
- Produces:
  - `findTableByToken(token: string): Promise<TableRow | null>` — resuelve tenant y local desde el token, sin conocer el tenant de antemano
  - `type TableRow = { id: string; tenantId: string; venueId: string; label: string; isActive: boolean }`
  - `type CartLineInput = { productId: string; quantity: number; extraIds: string[]; notes: string | null }`
  - `createPendingOrder(input: { tenantId: string; venueId: string; tableId: string; lines: CartLineInput[]; taxRate: number }): Promise<{ orderId: string; publicToken: string; totalCents: number; currency: string }>`
  - `attachPaymentIntent(tenantId: string, orderId: string, paymentIntentId: string): Promise<void>`
  - `markOrderPaid(paymentIntentId: string): Promise<{ alreadyPaid: boolean }>`
  - `getOrderByPublicToken(publicToken: string): Promise<OrderStatus | null>`
  - `type OrderStatus = { orderNumber: number; status: string; totalCents: number; currency: string }`

- [ ] **Step 1: Escribir el test que falla**

`tests/integration/orders.test.ts`:
```ts
import { beforeAll, describe, expect, it } from "vitest";
import { createPendingOrder, findTableByToken, markOrderPaid } from "@suarex/db";
import { admin, createTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

let tenant: TenantFixture;
let venueId: string;
let tableToken: string;
let tableId: string;
let productId: string;

beforeAll(async () => {
  tenant = await createTenantFixture(`ord-${nonce()}`);

  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;

  const { data: category } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `c-${nonce()}`,
      name_i18n: { es: "Vinos" },
      destination: "barra",
    })
    .select("id")
    .single();

  const { data: product } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: category?.id,
      name_i18n: { es: "Ribera" },
      price: 18.0,
    })
    .select("id")
    .single();
  productId = product?.id as string;

  const { data: table } = await admin
    .from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: "1" })
    .select("id, token")
    .single();
  tableId = table?.id as string;
  tableToken = table?.token as string;
});

describe("findTableByToken", () => {
  it("resuelve tenant y local desde el token", async () => {
    const row = await findTableByToken(tableToken);
    expect(row?.tenantId).toBe(tenant.tenantId);
    expect(row?.venueId).toBe(venueId);
  });

  it("devuelve null para un token inexistente", async () => {
    expect(await findTableByToken("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("createPendingOrder", () => {
  it("ignora cualquier precio que venga del cliente y usa el de la base de datos", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId, quantity: 2, extraIds: [], notes: null }],
      taxRate: 0.1,
    });

    // 18,00 € x 2 = 36,00 €. Nada de lo que mande el navegador puede alterarlo.
    expect(order.totalCents).toBe(3600);

    const { data } = await admin
      .from("orders")
      .select("status, total, subtotal, tax_amount, order_number, bar_status, kitchen_status")
      .eq("id", order.orderId)
      .single();

    expect(data?.status).toBe("pending");
    expect(Number(data?.total)).toBe(36);
    expect(Number(data?.subtotal) + Number(data?.tax_amount)).toBe(36);
    expect(data?.order_number).toBeGreaterThan(0);
    // El producto es de una categoría de barra, así que cocina no tiene nada que hacer.
    expect(data?.bar_status).toBe("pending");
    expect(data?.kitchen_status).toBe("na");
  });

  it("rechaza un producto de otro tenant", async () => {
    const otro = await createTenantFixture(`ord-otro-${nonce()}`);
    const { data: cat } = await admin
      .from("categories")
      .insert({ tenant_id: otro.tenantId, slug: `c-${nonce()}`, name_i18n: { es: "X" } })
      .select("id")
      .single();
    const { data: prod } = await admin
      .from("products")
      .insert({
        tenant_id: otro.tenantId,
        category_id: cat?.id,
        name_i18n: { es: "Ajeno" },
        price: 1,
      })
      .select("id")
      .single();

    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId: prod?.id as string, quantity: 1, extraIds: [], notes: null }],
        taxRate: 0.1,
      }),
    ).rejects.toThrow(/no disponible/i);
  });

  it("rechaza una cantidad no positiva", async () => {
    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId, quantity: 0, extraIds: [], notes: null }],
        taxRate: 0.1,
      }),
    ).rejects.toThrow();
  });
});

describe("markOrderPaid", () => {
  it("es idempotente", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
      taxRate: 0.1,
    });

    const pi = `pi_test_${nonce()}`;
    await admin.from("orders").update({ stripe_payment_intent_id: pi }).eq("id", order.orderId);

    const first = await markOrderPaid(pi);
    expect(first.alreadyPaid).toBe(false);

    const { data: afterFirst } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", order.orderId)
      .single();

    const second = await markOrderPaid(pi);
    expect(second.alreadyPaid).toBe(true);

    const { data: afterSecond } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", order.orderId)
      .single();

    expect(afterSecond?.status).toBe("paid");
    expect(afterSecond?.paid_at).toBe(afterFirst?.paid_at);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm test:integration -- tests/integration/orders.test.ts`
Expected: FAIL — `createPendingOrder is not exported`

- [ ] **Step 3: Implementar los repositorios**

Primero, tres accesores estrechos nuevos en `packages/db/src/client.ts`. Cada uno está acotado **por firma** a una sola tabla o función: ninguno es de propósito general, y por eso no abren un agujero en la garantía estructural.

```ts
/**
 * SEGUNDA EXENCIÓN DELIBERADA, con el mismo razonamiento que
 * `tenantsTableForHostResolution`: el token del QR es lo que determina a qué tenant
 * pertenece la mesa, así que la búsqueda no puede filtrarse por un tenant que aún no
 * se conoce. Acotado por firma a `tables`; no es un escape hatch reutilizable.
 */
export function tablesTableForTokenResolution() {
  return serviceClient().from("tables");
}

/**
 * TERCERA EXENCIÓN DELIBERADA. El webhook de Stripe identifica el pedido por
 * `stripe_payment_intent_id` y no sabe nada de tenants: Stripe no los conoce. La
 * búsqueda es por una columna con índice único global, así que devuelve una fila o
 * ninguna -- no puede usarse para barrer datos de nadie. Acotado por firma a `orders`.
 */
export function ordersTableForPaymentResolution() {
  return serviceClient().from("orders");
}

/**
 * CUARTA EXENCIÓN DELIBERADA. `next_order_number` es SECURITY DEFINER y recibe el
 * tenant como parámetro, así que el filtro va dentro de la propia función SQL.
 * Acotado por firma a esa única RPC.
 */
export function nextOrderNumberRpc(tenantId: string, venueId: string) {
  return serviceClient().rpc("next_order_number", {
    p_tenant_id: tenantId,
    p_venue_id: venueId,
  });
}
```

`packages/db/src/tables.ts`:
```ts
import { tablesTableForTokenResolution } from "./client.js";
import type { TableRow } from "./types.js";

/**
 * Como `findTenantByHost`, esta consulta ocurre ANTES de conocer el tenant: el token
 * del QR es precisamente lo que lo determina. A partir del `tenantId` devuelto, todo
 * lo demás va acotado.
 */
export async function findTableByToken(token: string): Promise<TableRow | null> {
  const { data, error } = await tablesTableForTokenResolution()
    .select("id, tenant_id, venue_id, label, is_active")
    .eq("token", token)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    tenantId: data.tenant_id as string,
    venueId: data.venue_id as string,
    label: data.label as string,
    isActive: data.is_active as boolean,
  };
}
```

`packages/db/src/orders.ts`:
```ts
import { computeTotals, eurosToCents, type PricedLine } from "@suarex/domain";
import { tenantScoped } from "./client.js";
import type { CartLineInput, OrderStatus } from "./types.js";

type ProductRow = {
  id: string;
  name_i18n: Record<string, string>;
  price: string | number;
  is_available: boolean;
  categories: { destination: string } | null;
};

export async function createPendingOrder(input: {
  tenantId: string;
  venueId: string;
  tableId: string;
  lines: CartLineInput[];
  taxRate: number;
}): Promise<{ orderId: string; publicToken: string; totalCents: number; currency: string }> {
  if (input.lines.length === 0) throw new Error("El pedido no tiene líneas");
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error(`Cantidad inválida: ${line.quantity}`);
    }
  }

  const productIds = [...new Set(input.lines.map((l) => l.productId))];

  // El filtro por tenant lo aplica tenantScoped: un producto de otro tenant
  // sencillamente no aparece, y la comprobación de abajo lo convierte en error.
  const { data: products, error } = await tenantScoped("products", input.tenantId)
    .select("id, name_i18n, price, is_available, categories(destination)")
    .in("id", productIds);
  if (error) throw error;

  const byId = new Map((products as unknown as ProductRow[]).map((p) => [p.id, p]));

  const priced: PricedLine[] = [];
  const rows: {
    product_id: string;
    name_snapshot: Record<string, string>;
    unit_price: number;
    quantity: number;
    line_total: number;
    destination: string;
    notes: string | null;
  }[] = [];

  for (const line of input.lines) {
    const product = byId.get(line.productId);
    if (!product || !product.is_available) {
      throw new Error(`Producto no disponible: ${line.productId}`);
    }

    const unitPrice = eurosToCents(Number(product.price));
    const pricedLine: PricedLine = { unitPrice, quantity: line.quantity, extras: [] };
    priced.push(pricedLine);

    rows.push({
      product_id: product.id,
      name_snapshot: product.name_i18n,
      unit_price: Number(product.price),
      quantity: line.quantity,
      line_total: (unitPrice * line.quantity) / 100,
      destination: product.categories?.destination ?? "cocina",
      notes: line.notes,
    });
  }

  const totals = computeTotals(priced, input.taxRate);

  const hasKitchen = rows.some((r) => r.destination === "cocina");
  const hasBar = rows.some((r) => r.destination === "barra");

  const { data: numberData, error: numberError } = await nextOrderNumberRpc(
    input.tenantId,
    input.venueId,
  );
  if (numberError) throw numberError;
  const orderNumber = numberData as number;

  const { data: order, error: orderError } = await tenantScoped("orders", input.tenantId)
    .insert({
      venue_id: input.venueId,
      table_id: input.tableId,
      order_number: orderNumber,
      channel: "qr-mesa",
      status: "pending",
      subtotal: totals.subtotal / 100,
      tax_amount: totals.taxAmount / 100,
      total: totals.total / 100,
      kitchen_status: hasKitchen ? "pending" : "na",
      bar_status: hasBar ? "pending" : "na",
    })
    .select("id, public_token, currency")
    .single();
  if (orderError) throw orderError;

  const { error: itemsError } = await tenantScoped("order_items", input.tenantId).insert(
    rows.map((r) => ({ ...r, order_id: order.id })),
  );
  if (itemsError) throw itemsError;

  return {
    orderId: order.id as string,
    publicToken: order.public_token as string,
    totalCents: totals.total,
    currency: order.currency as string,
  };
}

export async function attachPaymentIntent(
  tenantId: string,
  orderId: string,
  paymentIntentId: string,
): Promise<void> {
  const { error } = await tenantScoped("orders", tenantId)
    .update({ stripe_payment_intent_id: paymentIntentId })
    .eq("id", orderId);
  if (error) throw error;
}

/**
 * Idempotente por construcción: el `.eq("status", "pending")` hace que una segunda
 * llamada no encuentre filas que actualizar, así que `paid_at` conserva el instante
 * del primer cobro y el pedido no cambia. Devuelve si ya estaba pagado para que el
 * webhook pueda registrarlo sin tratarlo como error.
 */
export async function markOrderPaid(
  paymentIntentId: string,
): Promise<{ alreadyPaid: boolean }> {
  const { data, error } = await ordersTableForPaymentResolution()
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("stripe_payment_intent_id", paymentIntentId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;

  return { alreadyPaid: (data ?? []).length === 0 };
}

export async function getOrderByPublicToken(
  publicToken: string,
): Promise<OrderStatus | null> {
  const { data, error } = await ordersTableForPaymentResolution()
    .select("order_number, status, total, currency")
    .eq("public_token", publicToken)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    orderNumber: data.order_number as number,
    status: data.status as string,
    totalCents: eurosToCents(Number(data.total)),
    currency: data.currency as string,
  };
}
```

Nota sobre `markOrderPaid`: devuelve `alreadyPaid: false` tanto si acaba de marcar el pedido como si el PaymentIntent no corresponde a ninguno. Son casos distintos, pero para el webhook ambos significan "no hay nada más que hacer", y distinguirlos exigiría una lectura extra que no aporta. El test de la Task 6 fija ese comportamiento explícitamente.

Los tipos nuevos van en `packages/db/src/types.ts`:
```ts
export type TableRow = {
  id: string;
  tenantId: string;
  venueId: string;
  label: string;
  isActive: boolean;
};

export type CartLineInput = {
  productId: string;
  quantity: number;
  extraIds: string[];
  notes: string | null;
};

export type OrderStatus = {
  orderNumber: number;
  status: string;
  totalCents: number;
  currency: string;
};
```

Y los exports en `packages/db/src/index.ts`:
```ts
export { getCategories, getProducts } from "./catalog.js";
export {
  attachPaymentIntent,
  createPendingOrder,
  getOrderByPublicToken,
  markOrderPaid,
} from "./orders.js";
export { findTableByToken } from "./tables.js";
export { findTenantByHost, getTenantSettings } from "./tenants.js";
export type {
  CartLineInput,
  Category,
  OrderStatus,
  Product,
  TableRow,
  Tenant,
  TenantSettingsRow,
} from "./types.js";
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pnpm test:integration -- tests/integration/orders.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add packages/db tests/integration/orders.test.ts
git commit -m "feat(db): order creation with server-side price recomputation"
```

---

### Task 6: Cobro con Stripe y webhook

> **Preparada para Stripe Connect.** Cada cliente de la plataforma cobra en SU propia cuenta de Stripe, conectada por OAuth. La plataforma nunca ve la clave secreta de nadie: solo guarda un identificador de cuenta (`tenants.stripe_account_id`, columna que ya existe) y actúa sobre ella con la clave de la plataforma.
>
> El onboarding de Connect llega en el sub-proyecto 5, pero el cobro se escribe con su forma desde ahora: se lee `stripe_account_id` del tenant y, si tiene valor, se pasa como `stripeAccount`. Si está vacío se cobra contra la cuenta de la plataforma, que es lo que ocurre en local. Así activar Connect más adelante no obliga a reescribir el flujo de pago, el webhook ni los tests.

**Files:**
- Create: `apps/web/lib/stripe.ts`, `apps/web/app/api/orders/route.ts`, `apps/web/app/api/webhook/stripe/route.ts`
- Modify: `apps/web/package.json`, `apps/web/.env.local`
- Test: `tests/integration/stripe-webhook.test.ts`

**Interfaces:**
- Consumes: `findTableByToken`, `createPendingOrder`, `attachPaymentIntent`, `markOrderPaid` (Task 5); `getTenantSettings` (sub-proyecto 1).
- Produces:
  - `POST /api/orders` — body `{ tableToken, lines }`, responde `{ clientSecret, publicToken }`
  - `POST /api/webhook/stripe` — verifica firma y marca pagado

- [ ] **Step 1: Instalar Stripe y declarar variables**

```bash
pnpm --filter @suarex/web add stripe @stripe/stripe-js @stripe/react-stripe-js
```

Añadir a `apps/web/.env.local` (claves de **modo test**, nunca de producción):
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Step 2: Escribir el test de idempotencia del webhook**

`tests/integration/stripe-webhook.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { markOrderPaid } from "@suarex/db";
import { nonce } from "./helpers/tenants.js";

describe("markOrderPaid", () => {
  it("distingue un PaymentIntent que no corresponde a ningún pedido", async () => {
    // No es un caso benigno: significa que se cobró algo de lo que este sistema
    // no tiene registro, o que el webhook apunta al entorno equivocado.
    expect(await markOrderPaid(`pi_desconocido_${nonce()}`)).toBe("order-not-found");
  });
});
```

Nota: `markOrderPaid` devuelve `MarkPaidOutcome` (`"marked" | "already-paid" | "order-not-found"`), no un booleano. La cobertura de los tres casos ya vive en `tests/integration/orders.test.ts`; este fichero solo añade el caso que le importa al webhook.

- [ ] **Step 3: Implementar el cliente de Stripe**

`apps/web/lib/stripe.ts`:
```ts
import Stripe from "stripe";

let cached: Stripe | null = null;

export function stripeClient(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY es obligatoria");
  cached = new Stripe(key);
  return cached;
}
```

- [ ] **Step 4: Implementar la creación de pedido**

`apps/web/app/api/orders/route.ts`:
```ts
import { NextResponse } from "next/server";
import {
  attachPaymentIntent,
  createPendingOrder,
  findTableByToken,
  getTenantSettings,
} from "@suarex/db";
import { stripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    tableToken?: string;
    lines?: { productId: string; quantity: number; extraIds: string[]; notes: string | null }[];
  };

  if (!body.tableToken || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  const table = await findTableByToken(body.tableToken);
  if (!table || !table.isActive) {
    return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  }

  const settings = await getTenantSettings(table.tenantId);
  const taxRate = Number(
    (settings?.fiscal as { taxRate?: number } | undefined)?.taxRate ?? 0.1,
  );

  let order: Awaited<ReturnType<typeof createPendingOrder>>;
  try {
    order = await createPendingOrder({
      tenantId: table.tenantId,
      venueId: table.venueId,
      tableId: table.id,
      lines: body.lines,
      taxRate,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo crear el pedido" },
      { status: 422 },
    );
  }

  // Forma Connect: si el tenant tiene cuenta conectada, el cargo se crea SOBRE
  // ella y el dinero va a su cuenta, no a la de la plataforma. Sin cuenta
  // conectada (desarrollo local, o un tenant que aún no ha completado el
  // onboarding) se cobra contra la cuenta de la plataforma.
  const connectedAccount = await getTenantStripeAccount(table.tenantId);

  const intent = await stripeClient().paymentIntents.create(
    {
      amount: order.totalCents,
      currency: order.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: { order_id: order.orderId, tenant_id: table.tenantId },
    },
    connectedAccount ? { stripeAccount: connectedAccount } : undefined,
  );

  await attachPaymentIntent(table.tenantId, order.orderId, intent.id);

  return NextResponse.json({
    clientSecret: intent.client_secret,
    publicToken: order.publicToken,
  });
}
```

Añadir a `packages/db/src/tenants.ts` el lector de la cuenta conectada:

```ts
/**
 * Identificador de la cuenta de Stripe conectada del tenant (`acct_...`), o null
 * si aún no ha completado el onboarding de Connect. NO es un secreto: es el
 * identificador público de una cuenta. La clave secreta de un cliente nunca
 * llega a esta plataforma, que es justamente el motivo de usar Connect.
 */
export async function getTenantStripeAccount(tenantId: string): Promise<string | null> {
  const { data, error } = await tenantsTableForHostResolution()
    .select("stripe_account_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) throw error;
  return (data?.stripe_account_id as string | null) ?? null;
}
```

**Importante sobre el webhook con Connect:** un cargo creado sobre una cuenta conectada emite el evento en ESA cuenta, no en la de la plataforma. Stripe lo entrega con `event.account` relleno. El webhook debe funcionar en ambos casos, así que no asumas que el evento llega siempre de la plataforma. Con `stripe listen` en local se prueba el caso sin Connect; el caso con cuenta conectada se verifica en el sub-proyecto 5, cuando exista una cuenta real conectada. Deja constancia de esa limitación en tu informe en vez de simularla.

- [ ] **Step 5: Implementar el webhook**

`apps/web/app/api/webhook/stripe/route.ts`:
```ts
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { markOrderPaid } from "@suarex/db";
import { stripeClient } from "@/lib/stripe";

// `constructEvent` usa criptografía de Node; el runtime edge no sirve aquí.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Sin configurar" }, { status: 500 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Sin firma" }, { status: 400 });

  // El cuerpo debe leerse crudo: verificar la firma sobre el JSON reserializado falla.
  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(payload, signature, secret);
  } catch {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }

  if (event.type === "payment_intent.succeeded") {
    const outcome = await markOrderPaid(event.data.object.id);

    // Se responde 200 en los tres casos: devolver un error haría que Stripe
    // reintentara indefinidamente algo que no va a cambiar. Pero un pedido
    // inexistente no es benigno -- significa que se cobró algo de lo que este
    // sistema no tiene registro, o que el webhook apunta al entorno equivocado --
    // así que se registra de forma distinguible.
    if (outcome === "order-not-found") {
      console.error(
        `[stripe-webhook] PaymentIntent sin pedido asociado: ${event.data.object.id}`,
      );
    }
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 6: Verificar el webhook con la CLI de Stripe**

```bash
stripe listen --forward-to http://garum.localhost:3000/api/webhook/stripe
```
En otra terminal, disparar el evento y comprobar que el pedido pasa a `paid`:
```bash
stripe trigger payment_intent.succeeded
```
Expected: la CLI muestra `200` y el pedido correspondiente queda en `paid`.

Verificar también el rechazo por firma:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://garum.localhost:3000/api/webhook/stripe \
  -H "stripe-signature: t=1,v1=falso" -d '{}'
```
Expected: `400`

- [ ] **Step 7: Ejecutar la suite y commitear**

Run: `pnpm lint && pnpm typecheck && pnpm test:integration`
Expected: todo verde

```bash
git add apps/web packages/db tests/integration/stripe-webhook.test.ts pnpm-lock.yaml
git commit -m "feat(web): stripe payment intent and idempotent webhook"
```

---

### Task 7: Carta de mesa, carrito y pago

**Files:**
- Create: `apps/web/app/m/[token]/page.tsx`, `apps/web/app/m/[token]/CartClient.tsx`
- Create: `apps/web/app/pedido/[publicToken]/page.tsx`
- Modify: `supabase/seed.sql` (mesas de los tenants demo)
- Test: `tests/e2e/qr-order.spec.ts`

**Interfaces:**
- Consumes: `findTableByToken`, `getCategories`, `getProducts`; `POST /api/orders`.
- Produces: la ruta pública `/m/{token}` y la de seguimiento `/pedido/{publicToken}`.

- [ ] **Step 1: Sembrar mesas en los tenants demo**

Añadir al final de `supabase/seed.sql`:
```sql
insert into public.tables (tenant_id, venue_id, label, token, sort_order)
select v.tenant_id, v.id, m.label, m.token, m.sort_order
  from public.venues v
  join public.tenants t on t.id = v.tenant_id
  cross join (values
    ('1', '11111111-1111-1111-1111-111111111111'::uuid, 0),
    ('2', '22222222-2222-2222-2222-222222222222'::uuid, 1)
  ) as m(label, token, sort_order)
 where t.slug = 'garum';
```

Los tokens fijos son **solo para la semilla de desarrollo**, de modo que los tests e2e tengan una URL estable. En producción los genera `gen_random_uuid()`.

- [ ] **Step 2: Escribir el e2e que falla**

`tests/e2e/qr-order.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

const MESA_1 = "http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111";

test("un token de mesa desconocido devuelve 404", async ({ page }) => {
  const response = await page.goto(
    "http://garum.localhost:3000/m/00000000-0000-0000-0000-000000000000",
  );
  expect(response?.status()).toBe(404);
});

test("la carta de la mesa muestra los productos del tenant", async ({ page }) => {
  await page.goto(MESA_1);
  await expect(page.getByTestId("mesa-label")).toHaveText("1");
  await expect(page.getByTestId("product")).toContainText("Ribera del Duero");
});

test("añadir al carrito acumula el total del lado del cliente", async ({ page }) => {
  await page.goto(MESA_1);
  await page.getByTestId("add-to-cart").first().click();
  await page.getByTestId("add-to-cart").first().click();
  await expect(page.getByTestId("cart-total")).toHaveText("36,00 €");
});

test("la carta de un tenant no muestra productos de otro", async ({ page }) => {
  await page.goto(MESA_1);
  await expect(page.getByText("Tosta de jamón")).toHaveCount(0);
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `pnpm test:e2e -- tests/e2e/qr-order.spec.ts`
Expected: FAIL — la ruta `/m/[token]` no existe todavía

- [ ] **Step 4: Implementar la carta**

`apps/web/app/m/[token]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { findTableByToken, getCategories, getProducts } from "@suarex/db";
import { CartClient } from "./CartClient";

export default async function MesaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const table = await findTableByToken(token);
  if (!table || !table.isActive) notFound();

  const [categories, products] = await Promise.all([
    getCategories(table.tenantId),
    getProducts(table.tenantId),
  ]);

  return (
    <main>
      <h1>
        Mesa <span data-testid="mesa-label">{table.label}</span>
      </h1>
      <CartClient
        tableToken={token}
        categories={categories.map((c) => ({ id: c.id, name: c.nameI18n.es ?? c.slug }))}
        products={products.map((p) => ({
          id: p.id,
          categoryId: p.categoryId,
          name: p.nameI18n.es ?? "",
          priceCents: Math.round(p.price * 100),
        }))}
      />
    </main>
  );
}
```

`apps/web/app/m/[token]/CartClient.tsx`:
```tsx
"use client";

import { useMemo, useState } from "react";
import { formatCents } from "@suarex/domain";

type Product = { id: string; categoryId: string; name: string; priceCents: number };
type Category = { id: string; name: string };

export function CartClient({
  tableToken,
  categories,
  products,
}: {
  tableToken: string;
  categories: Category[];
  products: Product[];
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const totalCents = useMemo(
    () =>
      products.reduce(
        (sum, product) => sum + product.priceCents * (quantities[product.id] ?? 0),
        0,
      ),
    [products, quantities],
  );

  function add(productId: string) {
    setQuantities((current) => ({ ...current, [productId]: (current[productId] ?? 0) + 1 }));
  }

  async function checkout() {
    setError(null);
    const lines = Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity, extraIds: [], notes: null }));

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tableToken, lines }),
    });

    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "No se pudo crear el pedido");
      return;
    }

    const { publicToken } = (await response.json()) as { publicToken: string };
    window.location.href = `/pedido/${publicToken}`;
  }

  return (
    <>
      {categories.map((category) => (
        <section key={category.id}>
          <h2>{category.name}</h2>
          <ul>
            {products
              .filter((product) => product.categoryId === category.id)
              .map((product) => (
                <li key={product.id} data-testid="product">
                  {product.name} — {formatCents(product.priceCents, "es-ES", "EUR")}
                  <button type="button" data-testid="add-to-cart" onClick={() => add(product.id)}>
                    Añadir
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}

      <p data-testid="cart-total">{formatCents(totalCents, "es-ES", "EUR")}</p>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" disabled={totalCents === 0} onClick={checkout}>
        Pagar
      </button>
    </>
  );
}
```

`apps/web/app/pedido/[publicToken]/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { getOrderByPublicToken } from "@suarex/db";
import { formatCents } from "@suarex/domain";

export default async function PedidoPage({
  params,
}: {
  params: Promise<{ publicToken: string }>;
}) {
  const { publicToken } = await params;
  const order = await getOrderByPublicToken(publicToken);
  if (!order) notFound();

  return (
    <main>
      <h1>Pedido {order.orderNumber}</h1>
      <p data-testid="order-status">{order.status}</p>
      <p>{formatCents(order.totalCents, "es-ES", order.currency)}</p>
    </main>
  );
}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `supabase db reset && pnpm db:env && cp .env.test apps/web/.env.local && pnpm test:e2e`
Expected: PASS

Recuerda volver a añadir a `apps/web/.env.local` las tres variables de Stripe tras copiar `.env.test`.

- [ ] **Step 6: Criterio de aceptación de la fase A**

Run: `pnpm lint && pnpm typecheck && pnpm typecheck:tests && pnpm test && pnpm test:integration && pnpm test:e2e`
Expected: todo verde

- [ ] **Step 7: Commit**

```bash
git add apps/web supabase/seed.sql tests/e2e/qr-order.spec.ts
git commit -m "feat(web): table QR menu, cart and order creation"
```

---

## Verificación de la fase A contra el spec

| Requisito del spec | Tarea |
|---|---|
| Mesas con QR por local | 2 |
| Numeración por local y día, atómica | 2 |
| Pedidos con líneas y extras, precios congelados | 3 |
| `printed_at` / `printed_targets` desde el día 1 | 3 |
| Precios recalculados en servidor | 5 |
| IVA incluido, base por división | 4 |
| Webhook como única vía de marcar pagado | 6 |
| Idempotencia por `stripe_payment_intent_id` | 5, 6 |
| Carta pública en `/m/{token}` | 7 |
| Token de mesa desconocido devuelve 404 | 7 |
| Anti-fuga sobre las tablas nuevas | 2, 3 (automática) |

## Fuera de esta fase

Panel de comandas, seguimiento en vivo por sondeo y cierre de `memberships.role` van en el plan de la fase B. Emparejamiento de dispositivos e impresión ESC/POS, en el de la fase C. Cada fase tendrá su propio plan escrito cuando la anterior esté cerrada.

## Deuda consciente de esta fase

- Los extras (`order_item_extras`) tienen tabla y se persisten, pero la interfaz de la carta todavía no permite elegirlos. Se conecta en la fase B, cuando la carta gane detalle de producto.
- El pedido pendiente que nunca se paga se queda en la tabla. La limpieza por caducidad se añade en la fase B, cuando exista el panel donde verlos.
