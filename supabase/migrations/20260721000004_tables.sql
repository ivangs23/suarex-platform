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

-- Extiende assert_same_tenant() (definida en 20260721000002_catalog.sql) con ramas para
-- `tables` y `order_counters`: ambas tienen `venue_id -> venues.id` además de su propio
-- `tenant_id`, y un FK de Postgres se resuelve contra la tabla referenciada SIN pasar por
-- RLS. Sin esta rama, un cliente autenticado del tenant A podría insertar
-- tenant_id = A con el venue_id de un venue perteneciente a otro tenant C (dado un id de
-- venue adivinable o filtrado): no puede leer datos de C de vuelta, pero planta filas
-- atadas estructuralmente al venue de un tenant ajeno, y confundiría cualquier código que
-- haga join por venue_id sin filtrar también por tenant_id. Se mantiene el `else raise`
-- para que una tabla futura que reutilice este trigger sin añadir aquí su rama falle
-- ruidosamente, en vez de dejar `parent_tenant` en NULL por accidente (aunque, como ya
-- pasaba antes de esta rama, NULL igualmente dispara el "cross-tenant reference rejected"
-- de abajo -- el `else raise` solo lo hace explícito y con un mensaje más claro).
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
  elsif tg_table_name = 'tables' then
    select v.tenant_id into parent_tenant
      from public.venues v where v.id = new.venue_id;
  elsif tg_table_name = 'order_counters' then
    select v.tenant_id into parent_tenant
      from public.venues v where v.id = new.venue_id;
  else
    raise exception 'assert_same_tenant: tabla no configurada %', tg_table_name;
  end if;

  if parent_tenant is distinct from new.tenant_id then
    raise exception 'cross-tenant reference rejected';
  end if;

  return new;
end;
$$;

create trigger tables_same_tenant before insert or update on public.tables
  for each row execute function public.assert_same_tenant();
create trigger order_counters_same_tenant before insert or update on public.order_counters
  for each row execute function public.assert_same_tenant();

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

-- Finding 1: la policy de arriba es `for all`, así que RLS por sí sola no basta -- un
-- cliente autenticado del tenant propietario podía seguir haciendo PATCH/DELETE directo
-- contra su propia fila de order_counters vía PostgREST (poniendo last_number a
-- cualquier valor, o corriendo una carrera lectura-luego-escritura contra otro cliente),
-- rompiendo el único invariante que esta tabla existe para proteger: que dos pedidos
-- simultáneos nunca reciban el mismo número. La única vía de mutación debe ser
-- next_order_number(), SECURITY DEFINER y ya restringida a service_role arriba (y que
-- sigue funcionando tras este revoke porque corre con los privilegios de su dueño, el rol
-- que ejecuta las migraciones, no con los de `authenticated`). Se mantiene el SELECT de
-- `authenticated` deliberadamente: un panel de staff puede querer leer el contador de hoy,
-- y RLS ya acota esa lectura al propio tenant; solo se revocan los privilegios de
-- escritura directa. TRUNCATE se revoca explícitamente también: no es una fila afectada
-- por RLS en absoluto (RLS no se aplica a TRUNCATE), así que dejarlo concedido habría
-- permitido a cualquier cliente autenticado vaciar la tabla entera saltándose tanto RLS
-- como este mismo revoke de INSERT/UPDATE/DELETE.
revoke insert, update, delete, truncate on public.order_counters from authenticated;
