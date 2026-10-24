-- La zona horaria de cada sede, para que el agente imprima la hora del local en comandas y
-- recibos. El device NO lee `venues` (categoría B de 20260722000005_device_rls_hardening.sql)
-- y así sigue: esta RPC le da solo `(venue_id, timezone)` de su propio tenant (JWT), nada más
-- de la fila. Mismo patrón que `reserve_printed_self` y `device_heartbeat`.
create function public.device_zonas_horarias()
returns table (venue_id uuid, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.timezone
    from public.venues v
   where v.tenant_id = public.current_tenant_id();
$$;

revoke execute on function public.device_zonas_horarias () from anon, public;
grant execute on function public.device_zonas_horarias () to authenticated;
