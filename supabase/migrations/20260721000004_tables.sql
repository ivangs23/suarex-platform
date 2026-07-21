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
