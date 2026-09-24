-- ANALÍTICA DE CARTA: conversión del QR.
--
-- La pregunta del hostelero es "¿cuánta gente escanea y no pide?". Hoy solo se sabe lo que SÍ
-- se pidió; lo que no llegó a pedido es invisible.
--
-- Se guarda un CONTADOR agregado por sede y día, no un registro de eventos. La diferencia
-- importa: un log de escaneos con hora e IP sería un tratamiento de datos personales nuevo, con
-- su política de retención y su mención en la política de privacidad -- que hoy declara una
-- única cookie técnica y ninguna analítica. Un entero por sede y día no identifica a nadie, así
-- que esa declaración sigue siendo cierta. Además no crece: 365 filas por sede y año.
create table public.menu_scans (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  -- Fecha LOCAL de la sede, no UTC: un escaneo de las 00:30 en Madrid pertenece al día que el
  -- restaurante llama "ayer" si cierra a las 2, y desde luego no al día siguiente en UTC.
  dia date not null,
  escaneos integer not null default 0,
  primary key (tenant_id, venue_id, dia)
);

-- Sin política: RLS activa y ninguna regla = nadie salvo `service_role` (que la salta). Los
-- informes se sirven desde el servidor, y esta tabla no tiene por qué ser legible desde el
-- navegador de nadie, ni siquiera del gestor.
alter table public.menu_scans enable row level security;

/*
 * Suma un escaneo al contador del día de la sede de esa mesa.
 *
 * Es una RPC y no un upsert desde el cliente porque dos escaneos simultáneos en el mismo
 * segundo se pisarían: `on conflict do update` con `escaneos + 1` lo resuelve en la base, en
 * una sola sentencia. Mismo motivo que `next_order_number`.
 *
 * Una mesa desconocida o desactivada no cuenta y no es un error: quien escanea un QR retirado
 * ve el mismo 404 que antes, y el contador no tiene por qué enterarse.
 */
create function public.registrar_escaneo(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_venue uuid;
  v_tz text;
begin
  select t.tenant_id, t.venue_id into v_tenant, v_venue
    from public.tables t
   where t.id = p_table_id
     and t.is_active;
  if v_tenant is null then
    return;
  end if;

  select coalesce(v.timezone, 'Europe/Madrid') into v_tz
    from public.venues v
   where v.id = v_venue;

  insert into public.menu_scans (tenant_id, venue_id, dia, escaneos)
  values (v_tenant, v_venue, (now() at time zone coalesce(v_tz, 'Europe/Madrid'))::date, 1)
  on conflict (tenant_id, venue_id, dia)
  do update set escaneos = public.menu_scans.escaneos + 1;
end;
$$;

revoke execute on function public.registrar_escaneo (uuid) from public, anon, authenticated;
grant execute on function public.registrar_escaneo (uuid) to service_role;

-- Misma disciplina que el resto de tablas con `tenant_id`: `anon` sin ningún privilegio, y una
-- policy en la forma canónica que exige `tenant-isolation.test.ts`.
revoke all on public.menu_scans from anon;

-- Solo LECTURA para el personal del local, y solo de lo suyo. Escribe únicamente
-- `registrar_escaneo` (SECURITY DEFINER, ejecutable solo por `service_role`): si un miembro
-- del tenant pudiera escribir, podría inflar su propio contador, y un informe que uno mismo
-- puede alterar no informa de nada.
create policy menu_scans_read on public.menu_scans
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
