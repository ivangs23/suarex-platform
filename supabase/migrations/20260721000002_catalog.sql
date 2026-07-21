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
