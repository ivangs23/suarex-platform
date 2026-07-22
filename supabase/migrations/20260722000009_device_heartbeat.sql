-- C2a: heartbeat del dispositivo. La RLS del rol `device` es de solo lectura sobre su
-- propia fila (`devices_select_own`, 20260722000005); un heartbeat necesita ESCRIBIR
-- `last_seen_at`/`app_version` en esa fila, acotado a esas dos columnas -- algo que la RLS
-- por fila no expresa. Se resuelve con una RPC SECURITY DEFINER que actualiza SOLO esas
-- dos columnas y SOLO la fila cuyo `auth_user_id = auth.uid()` (el propio device). Las
-- columnas ya existen (20260722000001_devices_printers.sql), así que esto solo añade la
-- función y su grant. Mismo patrón de aislamiento por JWT que `reserve_printed_self`.
create or replace function public.device_heartbeat(p_app_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.devices
     set last_seen_at = now(),
         app_version = coalesce(p_app_version, app_version)
   where auth_user_id = auth.uid();
end;
$$;

revoke execute on function public.device_heartbeat (text) from anon, public;
grant execute on function public.device_heartbeat (text) to authenticated;
