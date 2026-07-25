-- MODIFICADORES OBLIGATORIOS: grupos de opciones con mínimo y máximo.
--
-- Hasta ahora `product_extras` era una lista plana de añadidos opcionales: marca los que
-- quieras, o ninguno. Eso vale para "extra de queso" y no vale para media carta española. Una
-- hamburguesa necesita UN punto de la carne (ni cero ni dos); un menú del día necesita UN primero
-- y UN segundo; un poke necesita entre uno y tres toppings. Sin poder exigirlo, esos platos o no
-- se pueden vender por QR/totem, o llegan a cocina sin la elección y alguien tiene que ir a
-- preguntar a la mesa -- que es exactamente el trabajo que este sistema existe para no hacer.
--
-- Es funcionalidad GENÉRICA: la estructura es la misma para todos los clientes, y lo que cambia
-- es qué grupos define cada uno en su carta. Un bar que no use grupos no nota nada.
create table public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name_i18n jsonb not null,
  -- `min_select = 0` es un grupo opcional (solo agrupa visualmente); `>= 1` lo hace obligatorio.
  -- `max_select = 1` es la elección única de toda la vida (el punto de la carne).
  min_select int not null default 0 check (min_select >= 0),
  max_select int not null default 1 check (max_select >= 1),
  sort_order int not null default 0,
  -- Un grupo que pide más de lo que permite no tiene ninguna selección válida: sería un producto
  -- imposible de añadir al carrito, y el sitio para atrapar eso es aquí, no en la pantalla.
  constraint product_option_groups_range check (max_select >= min_select)
);
create index product_option_groups_tenant_id_idx on public.product_option_groups (tenant_id);
create index product_option_groups_product_id_idx on public.product_option_groups (product_id);

-- Una extra pertenece como mucho a UN grupo. `null` es lo que ya existía: un añadido suelto,
-- opcional, sin más reglas -- así que toda la carta actual sigue comportándose igual sin tocar
-- una sola fila.
--
-- `on delete set null` y no `cascade`: borrar el grupo "Punto de la carne" no debe llevarse por
-- delante "Poco hecho", "Al punto" y "Muy hecho". Se quedan como añadidos sueltos, visibles y
-- recuperables; con `cascade`, un clic en el panel borraría opciones que costó escribir.
alter table public.product_extras
  add column group_id uuid references public.product_option_groups (id) on delete set null;
create index product_extras_group_id_idx on public.product_extras (group_id);

-- Mismo trigger que el resto del catálogo: una fila hija no puede apuntar a un padre de otro
-- tenant. Se MERGEA sobre la última versión vigente (20260722000001_devices_printers.sql, que a
-- su vez venía de 20260721000002/4/5) añadiendo solo la rama de la tabla nueva: pegar una versión
-- antigua aquí borraría en silencio las ramas de tables, orders, order_items, devices y printers,
-- y con ellas la barrera que impide atar una fila al padre de otro tenant. El `else raise` del
-- final es lo que convierte ese olvido en un error ruidoso en vez de en un agujero.
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
  elsif tg_table_name = 'product_option_groups' then
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

create trigger product_option_groups_same_tenant before insert or update on public.product_option_groups
  for each row execute function public.assert_same_tenant();

-- Una extra tampoco puede caer en un grupo de OTRO producto: sería una opción que la ficha nunca
-- enseña pero que la validación del pedido sí exigiría, o al revés. El trigger propio de
-- `product_extras` ya cubre el tenant; esto cubre el producto.
create or replace function public.assert_extra_group_same_product()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  group_product uuid;
begin
  if new.group_id is null then return new; end if;
  select g.product_id into group_product
    from public.product_option_groups g where g.id = new.group_id;
  if group_product is distinct from new.product_id then
    raise exception 'option group belongs to a different product';
  end if;
  return new;
end;
$$;

create trigger product_extras_group_same_product before insert or update on public.product_extras
  for each row execute function public.assert_extra_group_same_product();

-- ---------------------------------------------------------------- RLS
--
-- Copia exacta de la de `product_extras` tras el hardening de C1
-- (20260722000005_device_rls_hardening.sql): aislamiento por tenant y device fuera, ni lectura ni
-- escritura -- un agente de impresión construye el ticket con los snapshots ya congelados en
-- `order_items`/`order_item_extras`, no necesita ver la carta.
alter table public.product_option_groups enable row level security;

create policy product_option_groups_isolation on public.product_option_groups
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() is distinct from 'device'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() is distinct from 'device'
  );

revoke all on public.product_option_groups from anon;
