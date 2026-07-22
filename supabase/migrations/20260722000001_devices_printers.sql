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

-- Extiende assert_same_tenant() (definida en 20260721000002_catalog.sql, con ramas
-- añadidas en 20260721000004_tables.sql y 20260721000005_orders.sql, la última
-- versión vigente antes de esta migración) con ramas para `devices` y `printers`.
-- Se mergea sobre la función actual -- se preservan intactas TODAS las ramas
-- anteriores (products, product_extras, categories, tables, order_counters,
-- orders, order_items, order_item_extras) -- en vez de pegar una versión vieja
-- encima, que las habría borrado en silencio.
--
-- `devices.venue_id` es una FK a `venues` resuelta sin pasar por RLS, igual que
-- `tables`/`order_counters`: sin esta rama, un cliente autenticado del tenant A
-- podría insertar `tenant_id = A` con el `venue_id` de un venue de otro tenant.
-- `printers` tiene DOS FKs de este tipo: `venue_id` (siempre presente, mismo
-- patrón que `orders` con su `venue_id`) y, si `device_id` no es null,
-- `devices` (un dispositivo pertenece a un único tenant y una impresora no
-- debe poder atarse al dispositivo de otro).
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
  elsif tg_table_name = 'orders' then
    select v.tenant_id into parent_tenant
      from public.venues v where v.id = new.venue_id;
    if parent_tenant is distinct from new.tenant_id then
      raise exception 'cross-tenant reference rejected';
    end if;
    if new.table_id is not null then
      select t.tenant_id into parent_tenant
        from public.tables t where t.id = new.table_id;
    end if;
  elsif tg_table_name = 'order_items' then
    select o.tenant_id into parent_tenant
      from public.orders o where o.id = new.order_id;
  elsif tg_table_name = 'order_item_extras' then
    select i.tenant_id into parent_tenant
      from public.order_items i where i.id = new.order_item_id;
  elsif tg_table_name = 'devices' then
    select v.tenant_id into parent_tenant
      from public.venues v where v.id = new.venue_id;
  elsif tg_table_name = 'printers' then
    select v.tenant_id into parent_tenant
      from public.venues v where v.id = new.venue_id;
    if parent_tenant is distinct from new.tenant_id then
      raise exception 'cross-tenant reference rejected';
    end if;
    if new.device_id is not null then
      select d.tenant_id into parent_tenant
        from public.devices d where d.id = new.device_id;
    end if;
  else
    raise exception 'assert_same_tenant: tabla no configurada %', tg_table_name;
  end if;

  if parent_tenant is distinct from new.tenant_id then
    raise exception 'cross-tenant reference rejected';
  end if;

  return new;
end;
$$;

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
