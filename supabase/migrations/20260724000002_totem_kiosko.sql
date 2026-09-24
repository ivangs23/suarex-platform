-- Sub-proyecto 4 (modo totem / canal `kiosko`), Fase 1: datos + config.
-- Ver docs/superpowers/specs/2026-07-24-modo-totem-kiosko-design.md.

-- Etiqueta de mesa LIBRE que el cliente teclea en el totem "en mesa" (1-100). No casa con una
-- fila `tables` sembrada, así que `table_id` queda nulo en kiosko y el número vive aquí como
-- texto. El QR en mesa sigue usando `table_id`; son excluyentes. `channel` ya admite 'kiosko'
-- (20260721000005_orders.sql), así que no hace falta tocar su CHECK.
alter table public.orders add column table_label text;

-- El datáfono físico (pinpad de Paytef) atado a ESTE totem. Por dispositivo, no por tenant:
-- un mismo comercio puede tener varios totems, cada uno con su pinpad.
alter table public.devices add column pinpad_id text;

-- Config de pago del tenant (Paytef). El `secret_key` es sensible: esta tabla NO da lectura
-- directa al rol `device` -- solo owner/admin la gestionan, y el device la obtiene por la RPC
-- `get_payment_config_self` (SECURITY DEFINER) de abajo. Nunca se hornea en el build (el error
-- del kiosko-manuela legacy). Una fila por tenant.
create table public.tenant_payment_config (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  provider text not null default 'paytef' check (provider in ('paytef')),
  access_key text not null,
  secret_key text not null,
  company_id text,
  -- Modo simulación: por defecto ON (arranca seguro, sin cobrar de verdad hasta configurar el
  -- datáfono real). Pasar a real es solo cambiar esto + las credenciales.
  mock boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.tenant_payment_config enable row level security;

-- Gestión solo para owner/admin, acotada a su tenant (mismo patrón que `tenant_settings_write`).
-- El rol `device` queda EXCLUIDO de lectura directa: no hay policy que le aplique, así que un
-- SELECT suyo devuelve cero filas. El secreto le llega solo por la RPC.
create policy tenant_payment_config_manage on public.tenant_payment_config
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

revoke all on public.tenant_payment_config from anon;

-- El device obtiene la config de pago de SU tenant (más su propio pinpad) sin poder leer la
-- tabla directamente. SECURITY DEFINER acotada por `auth.uid()` -> la fila `devices` del propio
-- device -> su tenant. Un usuario que no sea un device emparejado no obtiene nada. Mismo patrón
-- de aislamiento por JWT que `device_heartbeat`/`reserve_printed_self`.
create or replace function public.get_payment_config_self()
returns table (
  provider text,
  access_key text,
  secret_key text,
  company_id text,
  mock boolean,
  pinpad_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_pinpad text;
begin
  select d.tenant_id, d.pinpad_id into v_tenant, v_pinpad
  from public.devices d
  where d.auth_user_id = auth.uid();

  if v_tenant is null then
    return; -- quien llama no es un device emparejado: sin config
  end if;

  return query
  select c.provider, c.access_key, c.secret_key, c.company_id, c.mock, v_pinpad
  from public.tenant_payment_config c
  where c.tenant_id = v_tenant;
end;
$$;

revoke execute on function public.get_payment_config_self () from anon, public;
grant execute on function public.get_payment_config_self () to authenticated;
