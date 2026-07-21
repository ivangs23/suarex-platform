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

-- Finding (autorreview de este task, mismo patrón que Finding 2 en
-- 20260721000004_tables.sql): `orders.venue_id` y `orders.table_id` son FKs a otras
-- tablas tenant-scoped que se resuelven sin pasar por RLS. Sin guarda, un cliente
-- authenticated del tenant A podría insertar `tenant_id = A` (pasa la policy) con un
-- venue_id/table_id real de otro tenant (si lo conoce o adivina), atando la fila
-- estructuralmente al venue/mesa ajenos. Se cierra con el mismo trigger.
create trigger orders_same_tenant before insert or update on public.orders
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

-- Extiende assert_same_tenant() (definida en 20260721000002_catalog.sql, con ramas para
-- `tables`/`order_counters` añadidas en 20260721000004_tables.sql) con ramas para
-- `orders`, `order_items` y `order_item_extras`. `order_items`/`order_item_extras` cuelgan
-- de un padre (orders / order_items) que ya lleva su propio tenant_id, resuelto vía FK sin
-- pasar por RLS: sin estas ramas, `parent_tenant` quedaría NULL para toda inserción en
-- estas dos tablas y el `else raise` de abajo rechazaría cualquier línea de pedido, no
-- solo las cross-tenant. `orders` en sí no cuelga de un padre único: comprueba primero
-- `venue_id` (siempre presente) y, si `table_id` no es null, lo comprueba también (ver
-- el Finding documentado arriba, junto a su trigger). Se preservan intactas las ramas de
-- `products`, `product_extras`, `categories`, `tables` y `order_counters` de las
-- migraciones anteriores.
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
  else
    raise exception 'assert_same_tenant: tabla no configurada %', tg_table_name;
  end if;

  if parent_tenant is distinct from new.tenant_id then
    raise exception 'cross-tenant reference rejected';
  end if;

  return new;
end;
$$;
