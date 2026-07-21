# Fundación Multitenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar el monorepo `suarex-platform` con un esquema multitenant aislado por RLS, resolución de tenant por Host y theming desde base de datos, de modo que dos tenants demo sirvan catálogos y marcas distintos desde el mismo build.

**Architecture:** Monorepo pnpm + Turborepo. Postgres (Supabase) con `tenant_id` en toda tabla de dominio y policies RLS que leen el claim del JWT. El comensal anónimo nunca habla con Supabase: los Server Components de Next leen a través de funciones repositorio en `packages/db` que exigen `tenantId` explícito. El middleware de Next resuelve el tenant por cabecera `Host` y el layout raíz inyecta la marca como variables CSS.

**Tech Stack:** pnpm 10.33, Turborepo 2, TypeScript 5.9 strict, Next 16 (App Router, React 19), Supabase CLI (stack local), Biome 2.4, Vitest 4, Playwright 1.5x, zod 4.

## Global Constraints

- Directorio de trabajo único: `/Users/ivangonzalez/Documents/proyectos/suarex-platform`. **Prohibido escribir en** `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2`, `web-prueba`.
- Prohibido aplicar migraciones a los proyectos Supabase existentes `vjrttuhdrkljcdixartp` (Garum) y `mapaaxihjyxfeaalhcjo` (Manuela). Todo el desarrollo usa el stack local de Supabase CLI.
- Node `>=22.12.0`. pnpm `10.33.0`.
- TypeScript en modo `strict`. Prohibido `any` explícito.
- Ninguna policy RLS puede ser `USING (true)`. Excepción única y declarada: lectura de `allergens` con `tenant_id is null`.
- Toda tabla de dominio lleva `tenant_id uuid not null` con índice. Toda clave única de negocio se compone con `tenant_id`.
- Los componentes de UI usan exclusivamente variables CSS. Prohibidos los literales hexadecimales de color en `apps/web` y `packages/ui`.
- Textos multiidioma en columnas `jsonb` con forma `{"es": "...", "en": "..."}`. Prohibidas las columnas `name_en` / `name_pt`.
- La función de tenant actual se llama `public.current_tenant_id()`. El spec la nombraba `auth.tenant_id()`; se cambia a propósito porque crear objetos en el esquema `auth` puede romper las actualizaciones gestionadas de Supabase. Este nombre es el único válido en todo el plan.
- Mensajes de commit en formato Conventional Commits.

---

## Estructura de ficheros

```
suarex-platform/
├── package.json                       scripts raíz, workspaces
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json
├── .env.example
├── supabase/
│   ├── config.toml                    stack local + custom access token hook
│   ├── migrations/
│   │   ├── 20260721000001_core_tenancy.sql
│   │   └── 20260721000002_catalog.sql
│   └── seed.sql                       dos tenants demo
├── packages/
│   ├── config/                        @suarex/config — lógica pura, sin I/O
│   │   ├── src/tenant-host.ts         Host → identificador de tenant
│   │   ├── src/branding.ts            defaults, merge, variables CSS
│   │   ├── src/settings.schema.ts     esquemas zod de tenant_settings
│   │   └── src/index.ts
│   └── db/                            @suarex/db — único módulo que toca Supabase
│       ├── src/client.ts              cliente service role (no exportado al exterior)
│       ├── src/tenants.ts             findTenantByHost, getTenantSettings
│       ├── src/catalog.ts             getCategories, getProducts
│       ├── src/types.ts               tipos de dominio
│       └── src/index.ts
├── apps/
│   └── web/
│       ├── proxy.ts                   middleware de resolución de tenant
│       ├── app/layout.tsx             inyección de variables CSS
│       ├── app/[mesa]/page.tsx        carta demo
│       ├── lib/tenant-context.ts      lectura del tenant resuelto
│       └── app/globals.css            solo var(--…), sin hex
└── tests/
    ├── integration/tenant-isolation.test.ts   suite anti-fuga generada
    └── e2e/two-tenants.spec.ts
```

Responsabilidad por paquete: `config` no importa nada de red y es 100 % testeable en unitarias; `db` es el único lugar del repo autorizado a importar `@supabase/supabase-js`; `apps/web` no conoce Supabase, solo llama funciones de `db`.

---

### Task 1: Bootstrap del monorepo y `@suarex/config`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `.env.example`
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`, `packages/config/src/index.ts`, `packages/config/src/tenant-host.ts`
- Test: `packages/config/src/tenant-host.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `parseTenantHost(host: string, rootDomains: string[]): TenantHostRef | null`
  - `type TenantHostRef = { kind: 'subdomain'; slug: string } | { kind: 'domain'; domain: string }`

- [ ] **Step 1: Crear los ficheros raíz del workspace**

`package.json`:
```json
{
  "name": "suarex-platform",
  "private": true,
  "packageManager": "pnpm@10.33.0",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "build": "turbo build",
    "test": "turbo test",
    "typecheck": "turbo typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "db:start": "supabase start",
    "db:reset": "supabase db reset",
    "db:env": "node scripts/write-test-env.mjs"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.12",
    "turbo": "^2.5.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.5"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**", "!.next/cache/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

`biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.12/schema.json",
  "files": { "includes": ["**", "!**/node_modules", "!**/.next", "!**/dist", "!**/.turbo"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "error" }
    }
  }
}
```

`.env.example`:
```
# Rellenar con `pnpm db:env` tras `pnpm db:start`
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# Dominios raíz para resolver subdominios de tenant, separados por coma
TENANT_ROOT_DOMAINS=localhost,suarex.app
```

- [ ] **Step 2: Crear el paquete `@suarex/config`**

`packages/config/package.json`:
```json
{
  "name": "@suarex/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "^4.3.6" },
  "devDependencies": { "typescript": "^5.9.3", "vitest": "^4.1.5" }
}
```

`packages/config/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: Escribir el test que falla**

`packages/config/src/tenant-host.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseTenantHost } from './tenant-host.js'

const ROOTS = ['localhost', 'suarex.app']

describe('parseTenantHost', () => {
  it('extrae el slug de un subdominio', () => {
    expect(parseTenantHost('garum.suarex.app', ROOTS)).toEqual({ kind: 'subdomain', slug: 'garum' })
  })

  it('ignora el puerto', () => {
    expect(parseTenantHost('manuela.localhost:3000', ROOTS)).toEqual({
      kind: 'subdomain',
      slug: 'manuela',
    })
  })

  it('normaliza mayúsculas', () => {
    expect(parseTenantHost('GARUM.Suarex.App', ROOTS)).toEqual({ kind: 'subdomain', slug: 'garum' })
  })

  it('trata un host ajeno como dominio propio', () => {
    expect(parseTenantHost('carta.garum.es', ROOTS)).toEqual({
      kind: 'domain',
      domain: 'carta.garum.es',
    })
  })

  it('rechaza el dominio raíz desnudo', () => {
    expect(parseTenantHost('suarex.app', ROOTS)).toBeNull()
  })

  it('rechaza www del dominio raíz', () => {
    expect(parseTenantHost('www.suarex.app', ROOTS)).toBeNull()
  })

  it('rechaza subdominios anidados', () => {
    expect(parseTenantHost('a.b.suarex.app', ROOTS)).toBeNull()
  })

  it('rechaza un host vacío', () => {
    expect(parseTenantHost('', ROOTS)).toBeNull()
  })
})
```

- [ ] **Step 4: Ejecutar el test y verificar que falla**

Run: `pnpm --filter @suarex/config test`
Expected: FAIL — `Failed to resolve import "./tenant-host.js"`

- [ ] **Step 5: Implementar el mínimo**

`packages/config/src/tenant-host.ts`:
```ts
export type TenantHostRef = { kind: 'subdomain'; slug: string } | { kind: 'domain'; domain: string }

const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'admin', 'app'])

export function parseTenantHost(host: string, rootDomains: string[]): TenantHostRef | null {
  const clean = host.trim().toLowerCase().split(':')[0]
  if (!clean) return null

  for (const root of rootDomains) {
    const normalizedRoot = root.toLowerCase()
    if (clean === normalizedRoot) return null
    if (!clean.endsWith(`.${normalizedRoot}`)) continue

    const prefix = clean.slice(0, -(normalizedRoot.length + 1))
    if (!prefix || prefix.includes('.')) return null
    if (RESERVED_SUBDOMAINS.has(prefix)) return null
    return { kind: 'subdomain', slug: prefix }
  }

  return { kind: 'domain', domain: clean }
}
```

`packages/config/src/index.ts`:
```ts
export { parseTenantHost } from './tenant-host.js'
export type { TenantHostRef } from './tenant-host.js'
```

- [ ] **Step 6: Ejecutar el test y verificar que pasa**

Run: `pnpm --filter @suarex/config test`
Expected: PASS — 8 tests

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json biome.json .env.example packages/config
git commit -m "feat(config): bootstrap monorepo and host-to-tenant resolution"
```

---

### Task 2: Esquema de tenancy y aislamiento RLS

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/20260721000001_core_tenancy.sql`
- Create: `scripts/write-test-env.mjs`

**Interfaces:**
- Consumes: nada.
- Produces (contrato SQL que usan las tareas 3, 4, 5 y 8):
  - Tablas `public.tenants`, `public.venues`, `public.tenant_settings`, `public.memberships`
  - `public.current_tenant_id() returns uuid`
  - `public.custom_access_token_hook(event jsonb) returns jsonb`

- [ ] **Step 1: Inicializar el stack local de Supabase**

```bash
supabase init
```

Editar `supabase/config.toml` y añadir al final el bloque del hook (el resto del fichero generado se deja igual):

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

- [ ] **Step 2: Escribir la migración de tenancy**

`supabase/migrations/20260721000001_core_tenancy.sql`:
```sql
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tablas núcleo

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  custom_domain text unique,
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  plan text not null default 'free',
  stripe_account_id text,
  stripe_customer_id text,
  created_at timestamptz not null default now()
);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  slug text not null,
  is_default boolean not null default false,
  timezone text not null default 'Europe/Madrid',
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index venues_tenant_id_idx on public.venues (tenant_id);
create unique index venues_single_default_per_tenant
  on public.venues (tenant_id) where is_default;

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  branding jsonb not null default '{}'::jsonb,
  fiscal jsonb not null default '{}'::jsonb,
  locale text not null default 'es',
  currency text not null default 'EUR',
  channels text[] not null default '{}',
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index memberships_tenant_id_idx on public.memberships (tenant_id);

-- ---------------------------------------------------------------- claim de tenant

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id',
    ''
  )::uuid
$$;

-- Inyecta tenant_id y tenant_role en el access token al iniciar sesión.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  membership record;
  claims jsonb;
begin
  select m.tenant_id, m.role
    into membership
    from public.memberships m
   where m.user_id = (event ->> 'user_id')::uuid
   order by m.created_at asc
   limit 1;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  if membership.tenant_id is not null then
    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(membership.tenant_id::text));
    claims := jsonb_set(claims, '{tenant_role}', to_jsonb(membership.role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook (jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook (jsonb) from authenticated, anon, public;
grant select on public.memberships to supabase_auth_admin;

-- ---------------------------------------------------------------- RLS

alter table public.tenants enable row level security;
alter table public.venues enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.memberships enable row level security;

create policy tenants_isolation on public.tenants
  for all to authenticated
  using (id = public.current_tenant_id())
  with check (id = public.current_tenant_id());

create policy venues_isolation on public.venues
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy tenant_settings_isolation on public.tenant_settings
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy memberships_isolation on public.memberships
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- El rol anónimo no tiene ninguna policy: el comensal nunca lee de Supabase
-- directamente, todo pasa por los Server Components de apps/web.
revoke all on public.tenants, public.venues, public.tenant_settings, public.memberships from anon;
```

- [ ] **Step 3: Aplicar la migración y verificar que arranca limpia**

```bash
supabase start
supabase db reset
```
Expected: `Finished supabase db reset.` sin errores de SQL.

- [ ] **Step 4: Verificar manualmente que la función de claim existe y devuelve NULL sin JWT**

Run:
```bash
supabase db reset >/dev/null && psql "$(supabase status -o json | node -e 'process.stdin.once("data",d=>console.log(JSON.parse(d).DB_URL))')" -c "select public.current_tenant_id() is null as sin_jwt;"
```
Expected: una fila con `sin_jwt | t`

- [ ] **Step 5: Escribir el script que vuelca las claves locales a `.env.test`**

`scripts/write-test-env.mjs`:
```js
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const raw = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' })
const status = JSON.parse(raw)

const lines = [
  `SUPABASE_URL=${status.API_URL}`,
  `SUPABASE_ANON_KEY=${status.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
  `SUPABASE_DB_URL=${status.DB_URL}`,
  'TENANT_ROOT_DOMAINS=localhost,suarex.app',
  '',
].join('\n')

writeFileSync('.env.test', lines)
console.log('.env.test escrito')
```

Añadir a `.gitignore`: `.env.test`

- [ ] **Step 6: Ejecutar el script y comprobar el fichero**

Run: `pnpm db:env && grep -c '^SUPABASE_' .env.test`
Expected: `4`

- [ ] **Step 7: Commit**

```bash
git add supabase scripts/write-test-env.mjs .gitignore
git commit -m "feat(db): multitenant core schema with JWT-claim RLS isolation"
```

---

### Task 3: Esquema de catálogo con `tenant_id`

**Files:**
- Create: `supabase/migrations/20260721000002_catalog.sql`

**Interfaces:**
- Consumes: `public.tenants`, `public.current_tenant_id()` (Task 2).
- Produces: tablas `public.allergens`, `public.categories`, `public.products`, `public.product_extras`.

- [ ] **Step 1: Escribir la migración de catálogo**

`supabase/migrations/20260721000002_catalog.sql`:
```sql
-- Alérgenos: tenant_id NULL = catálogo global de la UE, compartido y de solo lectura.
create table public.allergens (
  id serial primary key,
  tenant_id uuid references public.tenants (id) on delete cascade,
  name_i18n jsonb not null,
  icon text
);
create index allergens_tenant_id_idx on public.allergens (tenant_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  parent_id uuid references public.categories (id) on delete cascade,
  slug text not null,
  name_i18n jsonb not null,
  destination text not null default 'cocina' check (destination in ('cocina', 'barra')),
  image_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, slug)
);
create index categories_tenant_id_idx on public.categories (tenant_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  name_i18n jsonb not null,
  description_i18n jsonb not null default '{}'::jsonb,
  price numeric(10, 2) not null check (price >= 0),
  image_url text,
  allergen_ids int[] not null default '{}',
  is_available boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index products_tenant_id_idx on public.products (tenant_id);
create index products_category_id_idx on public.products (category_id);

create table public.product_extras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name_i18n jsonb not null,
  price numeric(10, 2) not null check (price >= 0)
);
create index product_extras_tenant_id_idx on public.product_extras (tenant_id);

-- Impide que una fila hija apunte a un padre de otro tenant.
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
  end if;

  if parent_tenant is distinct from new.tenant_id then
    raise exception 'cross-tenant reference rejected';
  end if;

  return new;
end;
$$;

create trigger categories_same_tenant before insert or update on public.categories
  for each row execute function public.assert_same_tenant();
create trigger products_same_tenant before insert or update on public.products
  for each row execute function public.assert_same_tenant();
create trigger product_extras_same_tenant before insert or update on public.product_extras
  for each row execute function public.assert_same_tenant();

-- ---------------------------------------------------------------- RLS

alter table public.allergens enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_extras enable row level security;

-- Excepción declarada: los alérgenos globales (tenant_id NULL) son legibles por
-- cualquier tenant, pero solo el service role puede escribirlos.
create policy allergens_read on public.allergens
  for select to authenticated
  using (tenant_id is null or tenant_id = public.current_tenant_id());

create policy allergens_write on public.allergens
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy categories_isolation on public.categories
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy products_isolation on public.products
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy product_extras_isolation on public.product_extras
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

revoke all on public.allergens, public.categories, public.products, public.product_extras from anon;

-- Los 14 alérgenos de la UE, globales.
insert into public.allergens (tenant_id, name_i18n, icon) values
  (null, '{"es":"Gluten","en":"Gluten"}', 'wheat'),
  (null, '{"es":"Crustáceos","en":"Crustaceans"}', 'shrimp'),
  (null, '{"es":"Huevos","en":"Eggs"}', 'egg'),
  (null, '{"es":"Pescado","en":"Fish"}', 'fish'),
  (null, '{"es":"Cacahuetes","en":"Peanuts"}', 'peanut'),
  (null, '{"es":"Soja","en":"Soybeans"}', 'soy'),
  (null, '{"es":"Lácteos","en":"Milk"}', 'milk'),
  (null, '{"es":"Frutos de cáscara","en":"Nuts"}', 'nut'),
  (null, '{"es":"Apio","en":"Celery"}', 'celery'),
  (null, '{"es":"Mostaza","en":"Mustard"}', 'mustard'),
  (null, '{"es":"Sésamo","en":"Sesame"}', 'sesame'),
  (null, '{"es":"Sulfitos","en":"Sulphites"}', 'sulphite'),
  (null, '{"es":"Altramuces","en":"Lupin"}', 'lupin'),
  (null, '{"es":"Moluscos","en":"Molluscs"}', 'mollusc');
```

- [ ] **Step 2: Aplicar y verificar**

Run: `supabase db reset`
Expected: `Finished supabase db reset.` sin errores.

- [ ] **Step 3: Verificar que los alérgenos globales se sembraron**

Run:
```bash
psql "$(grep SUPABASE_DB_URL .env.test | cut -d= -f2-)" -c "select count(*) from public.allergens where tenant_id is null;"
```
Expected: `14`

- [ ] **Step 4: Verificar que el trigger anti-referencia-cruzada dispara**

Run:
```bash
psql "$(grep SUPABASE_DB_URL .env.test | cut -d= -f2-)" <<'SQL'
insert into public.tenants (slug, name) values ('t-a', 'A'), ('t-b', 'B');
insert into public.categories (tenant_id, slug, name_i18n)
  select id, 'cat', '{"es":"Cat"}' from public.tenants where slug = 't-a';
insert into public.products (tenant_id, category_id, name_i18n, price)
  select (select id from public.tenants where slug = 't-b'),
         (select id from public.categories limit 1), '{"es":"X"}', 1.00;
SQL
```
Expected: `ERROR:  cross-tenant reference rejected`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721000002_catalog.sql
git commit -m "feat(db): tenant-scoped catalog schema with cross-tenant reference guard"
```

---

### Task 4: Suite anti-fuga generada por tabla

Esta es la prueba crítica del sub-proyecto. No se escribe caso por caso: se recorre el catálogo de tablas con columna `tenant_id`, de modo que una tabla nueva sin policy rompa el build.

**Files:**
- Create: `tests/integration/helpers/tenants.ts`, `tests/integration/tenant-isolation.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (script `test:integration`)

**Interfaces:**
- Consumes: esquema de las tareas 2 y 3, `.env.test` de la tarea 2.
- Produces:
  - `createTenantFixture(name: string): Promise<TenantFixture>`
  - `type TenantFixture = { tenantId: string; slug: string; email: string; client: SupabaseClient }`
  - `listTenantScopedTables(): Promise<string[]>`

- [ ] **Step 1: Instalar dependencias y configurar Vitest en la raíz**

```bash
pnpm add -Dw @supabase/supabase-js dotenv
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['dotenv/config'],
    env: { DOTENV_CONFIG_PATH: '.env.test' },
    testTimeout: 30_000,
    fileParallelism: false,
  },
})
```

Añadir a los scripts de `package.json` raíz:
```json
"test:integration": "vitest run --config vitest.config.ts"
```

- [ ] **Step 2: Escribir el helper de fixtures**

`tests/integration/helpers/tenants.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  throw new Error('Faltan variables en .env.test. Ejecuta `pnpm db:env`.')
}

export const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export type TenantFixture = {
  tenantId: string
  slug: string
  email: string
  client: SupabaseClient
}

const PASSWORD = 'fixture-password-1234'

export async function createTenantFixture(slug: string): Promise<TenantFixture> {
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ slug, name: slug })
    .select('id')
    .single()
  if (tenantError) throw tenantError

  const email = `${slug}@fixture.local`
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (userError) throw userError

  const { error: membershipError } = await admin
    .from('memberships')
    .insert({ user_id: user.user.id, tenant_id: tenant.id, role: 'owner' })
  if (membershipError) throw membershipError

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInError) throw signInError

  return { tenantId: tenant.id, slug, email, client }
}

export async function seedCatalog(tenantId: string, label: string): Promise<void> {
  const { data: category, error: categoryError } = await admin
    .from('categories')
    .insert({ tenant_id: tenantId, slug: `cat-${label}`, name_i18n: { es: `Cat ${label}` } })
    .select('id')
    .single()
  if (categoryError) throw categoryError

  const { data: product, error: productError } = await admin
    .from('products')
    .insert({
      tenant_id: tenantId,
      category_id: category.id,
      name_i18n: { es: `Prod ${label}` },
      price: 9.5,
    })
    .select('id')
    .single()
  if (productError) throw productError

  const { error: extraError } = await admin.from('product_extras').insert({
    tenant_id: tenantId,
    product_id: product.id,
    name_i18n: { es: `Extra ${label}` },
    price: 1.5,
  })
  if (extraError) throw extraError

  const { error: venueError } = await admin
    .from('venues')
    .insert({ tenant_id: tenantId, slug: 'principal', name: 'Principal', is_default: true })
  if (venueError) throw venueError

  const { error: settingsError } = await admin
    .from('tenant_settings')
    .insert({ tenant_id: tenantId, branding: { colors: { primary: '#000000' } } })
  if (settingsError) throw settingsError
}

/** Tablas de public con columna tenant_id, descubiertas en runtime. */
export async function listTenantScopedTables(): Promise<string[]> {
  const { data, error } = await admin.rpc('list_tenant_scoped_tables')
  if (error) throw error
  return (data as { table_name: string }[]).map((row) => row.table_name)
}
```

- [ ] **Step 3: Añadir la función SQL que descubre las tablas**

Crear `supabase/migrations/20260721000003_test_introspection.sql`:
```sql
-- Utilidad de introspección usada por la suite anti-fuga. Solo lectura de metadatos.
create or replace function public.list_tenant_scoped_tables()
returns table (table_name text)
language sql
stable
set search_path = ''
as $$
  select c.table_name::text
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and c.column_name = 'tenant_id'
     and t.table_type = 'BASE TABLE'
   order by c.table_name
$$;

grant execute on function public.list_tenant_scoped_tables () to service_role;
revoke execute on function public.list_tenant_scoped_tables () from anon, authenticated, public;
```

Run: `supabase db reset`
Expected: `Finished supabase db reset.`

- [ ] **Step 4: Escribir la suite anti-fuga (debe fallar antes de existir)**

`tests/integration/tenant-isolation.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest'
import {
  admin,
  createTenantFixture,
  listTenantScopedTables,
  seedCatalog,
  type TenantFixture,
} from './helpers/tenants.js'

/** Tablas cuya lectura admite filas compartidas (tenant_id NULL), declaradas a propósito. */
const SHARED_READ_TABLES = new Set(['allergens'])

let tenantA: TenantFixture
let tenantB: TenantFixture
let tables: string[]

beforeAll(async () => {
  for (const table of ['product_extras', 'products', 'categories', 'venues', 'tenant_settings']) {
    await admin.from(table).delete().not('tenant_id', 'is', null)
  }
  await admin.from('tenants').delete().like('slug', 'leak-%')

  tenantA = await createTenantFixture(`leak-a-${Date.now()}`)
  tenantB = await createTenantFixture(`leak-b-${Date.now()}`)
  await seedCatalog(tenantA.tenantId, 'a')
  await seedCatalog(tenantB.tenantId, 'b')

  tables = await listTenantScopedTables()
})

it('descubre al menos las tablas de dominio conocidas', () => {
  expect(tables).toEqual(
    expect.arrayContaining([
      'allergens',
      'categories',
      'memberships',
      'product_extras',
      'products',
      'tenant_settings',
      'venues',
    ]),
  )
})

describe('aislamiento entre tenants', () => {
  it('cada tabla con tenant_id tiene RLS activada', async () => {
    const { data, error } = await admin.rpc('list_tenant_scoped_tables')
    expect(error).toBeNull()
    const names = (data as { table_name: string }[]).map((r) => r.table_name)

    for (const table of names) {
      const { data: rls } = await admin
        .from('pg_tables_rls_check')
        .select('*')
        .eq('tablename', table)
        .maybeSingle()
      expect(rls?.rowsecurity, `${table} sin RLS`).toBe(true)
    }
  })

  it('SELECT nunca devuelve filas de otro tenant', async () => {
    for (const table of tables) {
      const { data, error } = await tenantA.client.from(table).select('tenant_id')
      expect(error, `${table}: SELECT devolvió error inesperado`).toBeNull()

      const foreign = (data ?? []).filter((row) => {
        const value = (row as { tenant_id: string | null }).tenant_id
        if (value === null) return !SHARED_READ_TABLES.has(table)
        return value !== tenantA.tenantId
      })
      expect(foreign, `${table}: fuga de ${foreign.length} filas`).toHaveLength(0)
    }
  })

  it('INSERT con el tenant_id de otro es rechazado', async () => {
    for (const table of ['categories', 'venues', 'tenant_settings']) {
      const payload: Record<string, unknown> = { tenant_id: tenantB.tenantId }
      if (table === 'categories') {
        payload.slug = `intruso-${Date.now()}`
        payload.name_i18n = { es: 'Intruso' }
      }
      if (table === 'venues') {
        payload.slug = `intruso-${Date.now()}`
        payload.name = 'Intruso'
      }

      const { error } = await tenantA.client.from(table).insert(payload)
      expect(error, `${table}: INSERT cross-tenant NO fue rechazado`).not.toBeNull()
    }
  })

  it('UPDATE sobre filas de otro tenant no afecta a ninguna fila', async () => {
    const { data } = await tenantA.client
      .from('categories')
      .update({ sort_order: 999 })
      .eq('tenant_id', tenantB.tenantId)
      .select('id')
    expect(data ?? []).toHaveLength(0)

    const { data: intact } = await admin
      .from('categories')
      .select('sort_order')
      .eq('tenant_id', tenantB.tenantId)
    expect((intact ?? []).every((row) => row.sort_order === 0)).toBe(true)
  })

  it('DELETE sobre filas de otro tenant no borra nada', async () => {
    const before = await admin
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantB.tenantId)

    await tenantA.client.from('categories').delete().eq('tenant_id', tenantB.tenantId)

    const after = await admin
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantB.tenantId)
    expect(after.count).toBe(before.count)
  })
})
```

- [ ] **Step 5: Añadir la vista de comprobación de RLS que el test necesita**

Añadir al final de `supabase/migrations/20260721000003_test_introspection.sql`:
```sql
create or replace view public.pg_tables_rls_check
with (security_invoker = true)
as
  select c.relname as tablename, c.relrowsecurity as rowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r';

revoke all on public.pg_tables_rls_check from anon, authenticated;
grant select on public.pg_tables_rls_check to service_role;
```

Run: `supabase db reset`
Expected: `Finished supabase db reset.`

- [ ] **Step 6: Ejecutar la suite y verificar que pasa**

Run: `pnpm db:env && pnpm test:integration`
Expected: PASS — 6 tests. Si alguno falla, la policy correspondiente está mal: **no relajar el test**, corregir la migración.

- [ ] **Step 7: Verificar que la suite detecta una tabla sin policy**

Crear un fichero temporal `supabase/migrations/29990101000000_leak_probe.sql`:
```sql
create table public.leak_probe (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  value text
);
```

Run: `supabase db reset && pnpm test:integration`
Expected: FAIL en `cada tabla con tenant_id tiene RLS activada` con `leak_probe sin RLS`

Luego borrar la sonda:
```bash
rm supabase/migrations/29990101000000_leak_probe.sql && supabase db reset && pnpm test:integration
```
Expected: PASS — 6 tests

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json tests/integration supabase/migrations/20260721000003_test_introspection.sql
git commit -m "test(db): generated cross-tenant leak suite over every tenant-scoped table"
```

---

### Task 5: `@suarex/db` — único módulo que habla con Supabase

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`
- Create: `packages/db/src/client.ts`, `packages/db/src/types.ts`, `packages/db/src/tenants.ts`, `packages/db/src/catalog.ts`, `packages/db/src/index.ts`
- Create: `tests/integration/db-repositories.test.ts`
- Modify: `biome.json` (regla que prohíbe importar el cliente crudo fuera de este paquete)

**Interfaces:**
- Consumes: esquema de las tareas 2 y 3; `parseTenantHost` de la tarea 1.
- Produces:
  - `findTenantByHost(host: string, rootDomains: string[]): Promise<Tenant | null>`
  - `getTenantSettings(tenantId: string): Promise<TenantSettingsRow | null>`
  - `getCategories(tenantId: string): Promise<Category[]>`
  - `getProducts(tenantId: string): Promise<Product[]>`
  - `type Tenant = { id: string; slug: string; name: string; status: 'active' | 'suspended' }`
  - `type Category = { id: string; slug: string; nameI18n: Record<string, string>; sortOrder: number }`
  - `type Product = { id: string; categoryId: string; nameI18n: Record<string, string>; descriptionI18n: Record<string, string>; price: number; isAvailable: boolean; sortOrder: number }`

- [ ] **Step 1: Crear el paquete**

`packages/db/package.json`:
```json
{
  "name": "@suarex/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@supabase/supabase-js": "^2.95.3",
    "@suarex/config": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.9.3" }
}
```

`packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 2: Escribir el test de integración de los repositorios (falla)**

`tests/integration/db-repositories.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest'
import { findTenantByHost, getCategories, getProducts, getTenantSettings } from '@suarex/db'
import { admin, createTenantFixture, seedCatalog, type TenantFixture } from './helpers/tenants.js'

const ROOTS = ['localhost', 'suarex.app']
let tenantA: TenantFixture
let tenantB: TenantFixture

beforeAll(async () => {
  tenantA = await createTenantFixture(`repo-a-${Date.now()}`)
  tenantB = await createTenantFixture(`repo-b-${Date.now()}`)
  await seedCatalog(tenantA.tenantId, 'a')
  await seedCatalog(tenantB.tenantId, 'b')
  await admin
    .from('tenants')
    .update({ custom_domain: 'carta.ejemplo.es' })
    .eq('id', tenantB.tenantId)
})

describe('findTenantByHost', () => {
  it('resuelve por subdominio', async () => {
    const tenant = await findTenantByHost(`${tenantA.slug}.suarex.app`, ROOTS)
    expect(tenant?.id).toBe(tenantA.tenantId)
  })

  it('resuelve por dominio propio', async () => {
    const tenant = await findTenantByHost('carta.ejemplo.es', ROOTS)
    expect(tenant?.id).toBe(tenantB.tenantId)
  })

  it('devuelve null para un host desconocido', async () => {
    expect(await findTenantByHost('nadie.suarex.app', ROOTS)).toBeNull()
  })

  it('devuelve null para el dominio raíz', async () => {
    expect(await findTenantByHost('suarex.app', ROOTS)).toBeNull()
  })
})

describe('repositorios de catálogo', () => {
  it('getCategories solo devuelve las del tenant pedido', async () => {
    const categories = await getCategories(tenantA.tenantId)
    expect(categories).toHaveLength(1)
    expect(categories[0]?.nameI18n.es).toBe('Cat a')
  })

  it('getProducts solo devuelve los del tenant pedido', async () => {
    const products = await getProducts(tenantB.tenantId)
    expect(products).toHaveLength(1)
    expect(products[0]?.nameI18n.es).toBe('Prod b')
    expect(products[0]?.price).toBe(9.5)
  })

  it('getTenantSettings devuelve la marca del tenant', async () => {
    const settings = await getTenantSettings(tenantA.tenantId)
    expect(settings?.branding).toMatchObject({ colors: { primary: '#000000' } })
  })
})
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `pnpm test:integration -- tests/integration/db-repositories.test.ts`
Expected: FAIL — `Cannot find module '@suarex/db'`

- [ ] **Step 4: Implementar el cliente y los repositorios**

`packages/db/src/client.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

/**
 * Cliente con service role. NO se exporta fuera del paquete: todo acceso pasa
 * por funciones repositorio que exigen un tenantId explícito.
 */
export function serviceClient(): SupabaseClient {
  if (cached) return cached

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias')
  }

  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}
```

`packages/db/src/types.ts`:
```ts
export type Tenant = {
  id: string
  slug: string
  name: string
  status: 'active' | 'suspended'
}

export type TenantSettingsRow = {
  tenantId: string
  branding: Record<string, unknown>
  fiscal: Record<string, unknown>
  locale: string
  currency: string
  channels: string[]
  features: Record<string, unknown>
}

export type Category = {
  id: string
  slug: string
  nameI18n: Record<string, string>
  sortOrder: number
}

export type Product = {
  id: string
  categoryId: string
  nameI18n: Record<string, string>
  descriptionI18n: Record<string, string>
  price: number
  isAvailable: boolean
  sortOrder: number
}
```

`packages/db/src/tenants.ts`:
```ts
import { parseTenantHost } from '@suarex/config'
import { serviceClient } from './client.js'
import type { Tenant, TenantSettingsRow } from './types.js'

export async function findTenantByHost(
  host: string,
  rootDomains: string[],
): Promise<Tenant | null> {
  const ref = parseTenantHost(host, rootDomains)
  if (!ref) return null

  const query = serviceClient().from('tenants').select('id, slug, name, status')
  const { data, error } =
    ref.kind === 'subdomain'
      ? await query.eq('slug', ref.slug).maybeSingle()
      : await query.eq('custom_domain', ref.domain).maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.id as string,
    slug: data.slug as string,
    name: data.name as string,
    status: data.status as Tenant['status'],
  }
}

export async function getTenantSettings(tenantId: string): Promise<TenantSettingsRow | null> {
  const { data, error } = await serviceClient()
    .from('tenant_settings')
    .select('tenant_id, branding, fiscal, locale, currency, channels, features')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    tenantId: data.tenant_id as string,
    branding: data.branding as Record<string, unknown>,
    fiscal: data.fiscal as Record<string, unknown>,
    locale: data.locale as string,
    currency: data.currency as string,
    channels: data.channels as string[],
    features: data.features as Record<string, unknown>,
  }
}
```

`packages/db/src/catalog.ts`:
```ts
import { serviceClient } from './client.js'
import type { Category, Product } from './types.js'

export async function getCategories(tenantId: string): Promise<Category[]> {
  const { data, error } = await serviceClient()
    .from('categories')
    .select('id, slug, name_i18n, sort_order')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    nameI18n: row.name_i18n as Record<string, string>,
    sortOrder: row.sort_order as number,
  }))
}

export async function getProducts(tenantId: string): Promise<Product[]> {
  const { data, error } = await serviceClient()
    .from('products')
    .select('id, category_id, name_i18n, description_i18n, price, is_available, sort_order')
    .eq('tenant_id', tenantId)
    .eq('is_available', true)
    .order('sort_order', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id as string,
    categoryId: row.category_id as string,
    nameI18n: row.name_i18n as Record<string, string>,
    descriptionI18n: row.description_i18n as Record<string, string>,
    price: Number(row.price),
    isAvailable: row.is_available as boolean,
    sortOrder: row.sort_order as number,
  }))
}
```

`packages/db/src/index.ts`:
```ts
export { findTenantByHost, getTenantSettings } from './tenants.js'
export { getCategories, getProducts } from './catalog.js'
export type { Category, Product, Tenant, TenantSettingsRow } from './types.js'
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `pnpm test:integration -- tests/integration/db-repositories.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Prohibir por lint que nadie más importe Supabase**

Añadir a `biome.json` dentro de `linter.rules`:
```json
"style": {
  "noRestrictedImports": {
    "level": "error",
    "options": {
      "paths": {
        "@supabase/supabase-js": "Solo packages/db puede importar Supabase. Usa una función repositorio de @suarex/db."
      }
    }
  }
}
```

Y una excepción para el propio paquete y los tests, en la raíz de `biome.json`:
```json
"overrides": [
  {
    "includes": ["packages/db/src/**", "tests/integration/helpers/**"],
    "linter": { "rules": { "style": { "noRestrictedImports": "off" } } }
  }
]
```

- [ ] **Step 7: Verificar que la regla dispara**

Run:
```bash
mkdir -p apps/web && printf "import { createClient } from '@supabase/supabase-js'\nexport const x = createClient\n" > apps/web/probe.ts && pnpm lint; rm apps/web/probe.ts
```
Expected: error `noRestrictedImports` señalando `apps/web/probe.ts`

- [ ] **Step 8: Commit**

```bash
git add packages/db biome.json tests/integration/db-repositories.test.ts
git commit -m "feat(db): tenant-scoped repositories and lint ban on raw Supabase imports"
```

---

### Task 6: Marca — defaults, merge y variables CSS

**Files:**
- Create: `packages/config/src/settings.schema.ts`, `packages/config/src/branding.ts`
- Create: `packages/config/src/branding.test.ts`
- Modify: `packages/config/src/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type Branding = { colors: { bg: string; fg: string; primary: string; accent: string; muted: string }; logoUrl: string | null; fonts: { display: string; body: string } }`
  - `DEFAULT_BRANDING: Branding`
  - `parseBranding(raw: unknown): Branding` — mezcla con los defaults y nunca lanza
  - `brandingToCssVars(branding: Branding): string`
  - `tenantSettingsSchema` (zod)

- [ ] **Step 1: Escribir el test que falla**

`packages/config/src/branding.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { brandingToCssVars, DEFAULT_BRANDING, parseBranding } from './branding.js'

describe('parseBranding', () => {
  it('devuelve los defaults con una entrada vacía', () => {
    expect(parseBranding({})).toEqual(DEFAULT_BRANDING)
  })

  it('mezcla colores parciales sin perder el resto', () => {
    const result = parseBranding({ colors: { primary: '#7b4f96' } })
    expect(result.colors.primary).toBe('#7b4f96')
    expect(result.colors.bg).toBe(DEFAULT_BRANDING.colors.bg)
  })

  it('descarta un color con formato inválido y usa el default', () => {
    const result = parseBranding({ colors: { primary: 'rojo chillón' } })
    expect(result.colors.primary).toBe(DEFAULT_BRANDING.colors.primary)
  })

  it('no lanza con basura', () => {
    expect(() => parseBranding(null)).not.toThrow()
    expect(parseBranding('texto')).toEqual(DEFAULT_BRANDING)
  })

  it('acepta logoUrl', () => {
    expect(parseBranding({ logoUrl: 'https://cdn/x.png' }).logoUrl).toBe('https://cdn/x.png')
  })
})

describe('brandingToCssVars', () => {
  it('genera una declaración por color y fuente', () => {
    const css = brandingToCssVars(DEFAULT_BRANDING)
    expect(css).toContain(`--color-bg:${DEFAULT_BRANDING.colors.bg}`)
    expect(css).toContain(`--color-primary:${DEFAULT_BRANDING.colors.primary}`)
    expect(css).toContain(`--font-display:${DEFAULT_BRANDING.fonts.display}`)
  })

  it('no emite comillas ni punto y coma sueltos que rompan el atributo style', () => {
    const css = brandingToCssVars(parseBranding({ colors: { primary: '#123456' } }))
    expect(css).not.toContain('"')
    expect(css.endsWith(';')).toBe(true)
  })
})
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm --filter @suarex/config test`
Expected: FAIL — `Failed to resolve import "./branding.js"`

- [ ] **Step 3: Implementar**

`packages/config/src/branding.ts`:
```ts
import { z } from 'zod'

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const FONT = /^[a-zA-Z0-9 ,'-]+$/

export type Branding = {
  colors: { bg: string; fg: string; primary: string; accent: string; muted: string }
  logoUrl: string | null
  fonts: { display: string; body: string }
}

export const DEFAULT_BRANDING: Branding = {
  colors: {
    bg: '#f5f1e8',
    fg: '#0f0f0f',
    primary: '#a88445',
    accent: '#1f1d1a',
    muted: '#d9d1bd',
  },
  logoUrl: null,
  fonts: { display: 'system-ui', body: 'system-ui' },
}

const colorSchema = z.string().regex(HEX)
const fontSchema = z.string().regex(FONT).max(64)

const brandingSchema = z.object({
  colors: z
    .object({
      bg: colorSchema.optional(),
      fg: colorSchema.optional(),
      primary: colorSchema.optional(),
      accent: colorSchema.optional(),
      muted: colorSchema.optional(),
    })
    .partial()
    .optional(),
  logoUrl: z.string().url().nullable().optional(),
  fonts: z
    .object({ display: fontSchema.optional(), body: fontSchema.optional() })
    .partial()
    .optional(),
})

/** Nunca lanza: un ajuste inválido degrada al default, la carta no se cae por un color. */
export function parseBranding(raw: unknown): Branding {
  const parsed = brandingSchema.safeParse(raw)
  const value = parsed.success ? parsed.data : {}

  return {
    colors: { ...DEFAULT_BRANDING.colors, ...(value.colors ?? {}) },
    logoUrl: value.logoUrl ?? DEFAULT_BRANDING.logoUrl,
    fonts: { ...DEFAULT_BRANDING.fonts, ...(value.fonts ?? {}) },
  }
}

export function brandingToCssVars(branding: Branding): string {
  const declarations = [
    `--color-bg:${branding.colors.bg}`,
    `--color-fg:${branding.colors.fg}`,
    `--color-primary:${branding.colors.primary}`,
    `--color-accent:${branding.colors.accent}`,
    `--color-muted:${branding.colors.muted}`,
    `--font-display:${branding.fonts.display}`,
    `--font-body:${branding.fonts.body}`,
  ]
  return `${declarations.join(';')};`
}
```

`packages/config/src/settings.schema.ts`:
```ts
import { z } from 'zod'

export const tenantSettingsSchema = z.object({
  branding: z.unknown(),
  fiscal: z
    .object({
      legalName: z.string().optional(),
      cif: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      taxRate: z.number().min(0).max(1).optional(),
    })
    .partial()
    .default({}),
  locale: z.string().default('es'),
  currency: z.string().length(3).default('EUR'),
  channels: z.array(z.enum(['qr-mesa', 'kiosko'])).default([]),
  features: z.record(z.string(), z.boolean()).default({}),
})

export type TenantSettings = z.infer<typeof tenantSettingsSchema>
```

Reemplazar `packages/config/src/index.ts`:
```ts
export { parseTenantHost } from './tenant-host.js'
export type { TenantHostRef } from './tenant-host.js'
export { brandingToCssVars, DEFAULT_BRANDING, parseBranding } from './branding.js'
export type { Branding } from './branding.js'
export { tenantSettingsSchema } from './settings.schema.js'
export type { TenantSettings } from './settings.schema.js'
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pnpm --filter @suarex/config test`
Expected: PASS — 15 tests

- [ ] **Step 5: Commit**

```bash
git add packages/config
git commit -m "feat(config): branding defaults, safe merge and CSS variable emission"
```

---

### Task 7: `apps/web` — resolución de tenant por Host y theming

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`
- Create: `apps/web/proxy.ts`, `apps/web/lib/tenant-context.ts`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/not-found.tsx`, `apps/web/app/suspended/page.tsx`

**Interfaces:**
- Consumes: `findTenantByHost`, `getTenantSettings` (Task 5); `parseBranding`, `brandingToCssVars` (Task 6).
- Produces:
  - `requireTenant(): Promise<Tenant>` — lee el tenant resuelto por el middleware desde las cabeceras
  - Cabecera interna `x-suarex-tenant-id`, `x-suarex-tenant-slug`

- [ ] **Step 1: Crear la app**

`apps/web/package.json`:
```json
{
  "name": "@suarex/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@suarex/config": "workspace:*",
    "@suarex/db": "workspace:*",
    "next": "^16.2.6",
    "react": "^19.2.4",
    "react-dom": "^19.2.4"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    "typescript": "^5.9.3"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@suarex/config', '@suarex/db'],
}

export default config
```

- [ ] **Step 2: Escribir el middleware de resolución**

`apps/web/proxy.ts`:
```ts
import { NextResponse, type NextRequest } from 'next/server'
import { findTenantByHost } from '@suarex/db'

const ROOT_DOMAINS = (process.env.TENANT_ROOT_DOMAINS ?? 'localhost').split(',')

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? ''

  let tenant: Awaited<ReturnType<typeof findTenantByHost>>
  try {
    tenant = await findTenantByHost(host, ROOT_DOMAINS)
  } catch {
    // Fallo de infraestructura: 503, nunca servir el tenant equivocado.
    return new NextResponse('Servicio no disponible', { status: 503 })
  }

  if (!tenant) {
    return NextResponse.rewrite(new URL('/not-found', request.url), { status: 404 })
  }

  if (tenant.status === 'suspended') {
    return NextResponse.rewrite(new URL('/suspended', request.url), { status: 503 })
  }

  const headers = new Headers(request.headers)
  headers.set('x-suarex-tenant-id', tenant.id)
  headers.set('x-suarex-tenant-slug', tenant.slug)

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

`apps/web/lib/tenant-context.ts`:
```ts
import { headers } from 'next/headers'

export type ResolvedTenant = { id: string; slug: string }

export async function requireTenant(): Promise<ResolvedTenant> {
  const headerList = await headers()
  const id = headerList.get('x-suarex-tenant-id')
  const slug = headerList.get('x-suarex-tenant-slug')

  if (!id || !slug) {
    throw new Error('Tenant no resuelto: el middleware no se ejecutó para esta ruta')
  }

  return { id, slug }
}
```

- [ ] **Step 3: Escribir el layout que inyecta la marca**

`apps/web/app/globals.css`:
```css
:root {
  --color-bg: #f5f1e8;
  --color-fg: #0f0f0f;
  --color-primary: #a88445;
  --color-accent: #1f1d1a;
  --color-muted: #d9d1bd;
  --font-display: system-ui;
  --font-body: system-ui;
}

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-body);
}

h1,
h2 {
  font-family: var(--font-display);
  color: var(--color-primary);
}
```

`apps/web/app/layout.tsx`:
```tsx
import type { ReactNode } from 'react'
import { brandingToCssVars, parseBranding } from '@suarex/config'
import { getTenantSettings } from '@suarex/db'
import { requireTenant } from '@/lib/tenant-context'
import './globals.css'

export default async function RootLayout({ children }: { children: ReactNode }) {
  const tenant = await requireTenant()
  const settings = await getTenantSettings(tenant.id)
  const branding = parseBranding(settings?.branding)

  return (
    <html lang={settings?.locale ?? 'es'} data-tenant={tenant.slug}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `:root{${brandingToCssVars(branding)}}` }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

Se inyecta un bloque `<style>` en lugar de un atributo `style` porque las variables CSS deben aplicarse en `:root` para que las herede toda la página, y React no permite escribir texto CSS crudo en la prop `style`. La cadena es segura porque `parseBranding` valida cada color contra `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/` y cada fuente contra `/^[a-zA-Z0-9 ,'-]+$/`, así que no puede contener `<`, `}` ni comillas.

`apps/web/app/not-found.tsx`:
```tsx
export default function NotFound() {
  return (
    <main>
      <h1>Carta no encontrada</h1>
      <p>Esta dirección no corresponde a ningún establecimiento.</p>
    </main>
  )
}
```

`apps/web/app/suspended/page.tsx`:
```tsx
export default function Suspended() {
  return (
    <main>
      <h1>Servicio temporalmente suspendido</h1>
      <p>Este establecimiento no tiene el servicio activo en este momento.</p>
    </main>
  )
}
```

- [ ] **Step 4: Instalar y comprobar que compila**

Run: `pnpm install && pnpm --filter @suarex/web typecheck`
Expected: sin errores

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): host-based tenant resolution and DB-driven theming"
```

---

### Task 8: Carta demo, semilla de dos tenants y e2e

**Files:**
- Create: `apps/web/app/[mesa]/page.tsx`
- Create: `supabase/seed.sql`
- Create: `tests/e2e/two-tenants.spec.ts`, `playwright.config.ts`
- Modify: `package.json` (script `test:e2e`)

**Interfaces:**
- Consumes: `requireTenant` (Task 7), `getCategories`, `getProducts` (Task 5).
- Produces: la ruta `/{mesa}` y la semilla de los tenants `garum` y `manuela`.

- [ ] **Step 1: Escribir la semilla de dos tenants**

`supabase/seed.sql`:
```sql
with t as (
  insert into public.tenants (slug, name, status) values
    ('garum', 'Garum Vinoteca', 'active'),
    ('manuela', 'Manuela Desayuna', 'active')
  returning id, slug
)
insert into public.tenant_settings (tenant_id, branding, locale, currency, channels)
select
  t.id,
  case t.slug
    when 'garum' then '{"colors":{"bg":"#d6e8d2","primary":"#7b4f96","accent":"#4a7860"}}'::jsonb
    else '{"colors":{"bg":"#fff8e7","primary":"#c28744","accent":"#2c1a0f"}}'::jsonb
  end,
  'es', 'EUR',
  case t.slug when 'garum' then array['qr-mesa'] else array['kiosko'] end
from t;

insert into public.venues (tenant_id, slug, name, is_default)
select id, 'principal', 'Principal', true from public.tenants where slug in ('garum', 'manuela');

insert into public.categories (tenant_id, slug, name_i18n, destination, sort_order)
select id, 'vinos', '{"es":"Vinos","en":"Wines"}', 'barra', 0
  from public.tenants where slug = 'garum'
union all
select id, 'tostas', '{"es":"Tostas","en":"Toasts"}', 'cocina', 0
  from public.tenants where slug = 'manuela';

insert into public.products (tenant_id, category_id, name_i18n, price, sort_order)
select c.tenant_id, c.id, '{"es":"Ribera del Duero","en":"Ribera del Duero"}', 18.00, 0
  from public.categories c join public.tenants t on t.id = c.tenant_id
 where t.slug = 'garum'
union all
select c.tenant_id, c.id, '{"es":"Tosta de jamón","en":"Ham toast"}', 4.50, 0
  from public.categories c join public.tenants t on t.id = c.tenant_id
 where t.slug = 'manuela';
```

Run: `supabase db reset`
Expected: `Finished supabase db reset.`

- [ ] **Step 2: Escribir la ruta de carta**

`apps/web/app/[mesa]/page.tsx`:
```tsx
import { getCategories, getProducts } from '@suarex/db'
import { requireTenant } from '@/lib/tenant-context'

export default async function MenuPage({ params }: { params: Promise<{ mesa: string }> }) {
  const { mesa } = await params
  const tenant = await requireTenant()

  const [categories, products] = await Promise.all([
    getCategories(tenant.id),
    getProducts(tenant.id),
  ])

  return (
    <main>
      <h1 data-testid="tenant-name">{tenant.slug}</h1>
      <p data-testid="mesa">Mesa {mesa}</p>

      {categories.map((category) => (
        <section key={category.id} data-testid="category">
          <h2>{category.nameI18n.es}</h2>
          <ul>
            {products
              .filter((product) => product.categoryId === category.id)
              .map((product) => (
                <li key={product.id} data-testid="product">
                  {product.nameI18n.es} — {product.price.toFixed(2)} €
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
```

- [ ] **Step 3: Escribir el e2e (falla si hay fuga entre tenants)**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://garum.localhost:3000' },
  webServer: {
    command: 'pnpm --filter @suarex/web dev',
    url: 'http://garum.localhost:3000/1',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

`tests/e2e/two-tenants.spec.ts`:
```ts
import { expect, test } from '@playwright/test'

test('garum sirve su catálogo y su marca', async ({ page }) => {
  await page.goto('http://garum.localhost:3000/5')

  await expect(page.getByTestId('tenant-name')).toHaveText('garum')
  await expect(page.getByTestId('mesa')).toHaveText('Mesa 5')
  await expect(page.getByTestId('product')).toHaveText(/Ribera del Duero/)

  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
  )
  expect(bg).toBe('#d6e8d2')
})

test('manuela sirve un catálogo y una marca distintos', async ({ page }) => {
  await page.goto('http://manuela.localhost:3000/2')

  await expect(page.getByTestId('tenant-name')).toHaveText('manuela')
  await expect(page.getByTestId('product')).toHaveText(/Tosta de jamón/)

  const bg = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
  )
  expect(bg).toBe('#fff8e7')
})

test('ningún producto de un tenant aparece en el otro', async ({ page }) => {
  await page.goto('http://garum.localhost:3000/1')
  await expect(page.getByText('Tosta de jamón')).toHaveCount(0)

  await page.goto('http://manuela.localhost:3000/1')
  await expect(page.getByText('Ribera del Duero')).toHaveCount(0)
})

test('un host desconocido devuelve 404', async ({ page }) => {
  const response = await page.goto('http://desconocido.localhost:3000/1')
  expect(response?.status()).toBe(404)
})
```

- [ ] **Step 4: Instalar Playwright y añadir el script**

```bash
pnpm add -Dw @playwright/test && pnpm exec playwright install chromium
```

Añadir a los scripts de `package.json` raíz:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 5: Ejecutar el e2e y verificar que pasa**

Antes de correrlo, copiar las claves locales al entorno de la app:
```bash
cp .env.test apps/web/.env.local
pnpm test:e2e
```
Expected: PASS — 4 tests

- [ ] **Step 6: Ejecutar la verificación completa**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @suarex/config test && pnpm test:integration && pnpm test:e2e`
Expected: todo en verde. Este comando es el criterio de aceptación del sub-proyecto 1.

- [ ] **Step 7: Commit**

```bash
git add apps/web supabase/seed.sql tests/e2e playwright.config.ts package.json
git commit -m "feat(web): demo menu route with two seeded tenants and isolation e2e"
```

- [ ] **Step 8: Documentar el arranque en el README**

`README.md`:
```markdown
# SuarEx Platform

Plataforma multitenant para hostelería. Un despliegue, N negocios.

## Arranque

```bash
pnpm install
supabase start
pnpm db:env
cp .env.test apps/web/.env.local
pnpm --filter @suarex/web dev
```

Abrir `http://garum.localhost:3000/5` y `http://manuela.localhost:3000/2`.

## Verificación

```bash
pnpm lint && pnpm typecheck && pnpm test:integration && pnpm test:e2e
```

## Reglas del repo

- Solo `packages/db` importa `@supabase/supabase-js`. El resto usa funciones repositorio.
- Ninguna policy RLS puede ser `USING (true)`. Excepción declarada: lectura de `allergens` globales.
- Toda tabla de dominio lleva `tenant_id not null`. La suite anti-fuga lo verifica sola.
- Los componentes usan variables CSS, nunca hex literales.
- Los repos `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2` y `web-prueba` siguen en producción y **no se tocan**.
```

```bash
git add README.md
git commit -m "docs: repo bootstrap and house rules"
```

---

## Verificación final del sub-proyecto

| Requisito del spec | Tarea |
|---|---|
| Esqueleto del monorepo | 1 |
| Proyecto Supabase nuevo (stack local) | 2 |
| Esquema `tenants`, `venues`, `tenant_settings`, `memberships` | 2 |
| Custom access token hook con `tenant_id` y `role` | 2 |
| Catálogo con `tenant_id` y `name_i18n` | 3 |
| `allergens` globales con excepción declarada | 3 |
| RLS en todas las tablas, sin `USING (true)` | 2, 3 |
| Suite anti-fuga generada por tabla | 4 |
| Comensal anónimo sin acceso directo a Supabase | 3 (revoke a `anon`), 5 (repositorios) |
| Regla que impide usar el cliente crudo fuera de `packages/db` | 5 |
| Resolución de tenant por Host con caché | 1, 5, 7 |
| Theming desde base de datos por variables CSS | 6, 7 |
| Manejo de errores: 404, 503 suspendido, 503 fallo de resolución, defaults de branding | 6, 7 |
| Dos tenants demo con marcas y catálogos distintos | 8 |

## Fuera de alcance, confirmado

Pedidos, pagos, impresión, aplicación de escritorio, CRUD de administración, billing y canal kiosko. Cada uno tiene su sub-proyecto en la hoja de ruta del spec.

## Deuda consciente

- La caché del Runtime Cache para la resolución de tenant no se implementa en la tarea 7: cada petición hace una consulta. Se añade en el sub-proyecto 2, cuando haya tráfico real que lo justifique.
- `supabase/migrations/20260721000003_test_introspection.sql` crea utilidades de test en la base de producción. Antes del primer despliegue real hay que moverlas a un fichero aplicado solo en local y CI.
