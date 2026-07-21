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
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id',
    ''
  )::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

-- Inyecta tenant_id y tenant_role en el access token al iniciar sesión.
-- SECURITY DEFINER: GoTrue invoca esta función como supabase_auth_admin, que no
-- pertenece al rol authenticated y por tanto no pasaría la RLS de memberships.
-- La función corre con los privilegios de su dueño (el rol que ejecuta la
-- migración) para poder leer memberships; el grant/revoke de abajo asegura que
-- solo supabase_auth_admin puede invocarla, y search_path = '' con referencias
-- totalmente cualificadas evita hijacking de search_path.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
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

-- ATENCIÓN, subproyectos 2-6: esta policy solo acota por tenant_id, NUNCA consulta
-- `role`. Un usuario autenticado con role='staff' puede hoy
-- `update memberships set role = 'owner' where user_id = <su propio user_id>` y sería
-- owner en el siguiente refresco de token (custom_access_token_hook lee memberships sin
-- volver a comprobar quién hizo el último UPDATE). No es explotable todavía porque no
-- existe ninguna UI/API autenticada que exponga un UPDATE a esta tabla, pero en cuanto el
-- CRUD de administración construya sobre esta policy asumiendo que `role` significa algo,
-- deja de ser seguro. NO se restringe `role` en esta migración a propósito -- qué
-- restricción exacta aplicar (solo owner puede cambiar roles, no puedes tocar el tuyo
-- propio, etc.) es una decisión de diseño del sub-proyecto de administración, no de esta
-- ronda de fixes. Cualquier camino de escritura autenticado hacia esta tabla DEBE resolver
-- esto antes de salir a producción.
create policy memberships_isolation on public.memberships
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- El rol anónimo no tiene ninguna policy: el comensal nunca lee de Supabase
-- directamente, todo pasa por los Server Components de apps/web.
revoke all on public.tenants, public.venues, public.tenant_settings, public.memberships from anon;
