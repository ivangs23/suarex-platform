-- #7: el device reporta las impresoras que ve el SO, para que el panel admin ofrezca un
-- desplegable en vez de que el owner teclee el nombre Windows a mano (un typo = OpenPrinterW
-- falla y el ticket se reintenta para siempre sin imprimir, en silencio).
--
-- Dónde se guarda: una columna `printers text[]` en la propia fila del device. La escribe el
-- heartbeat (misma RPC SECURITY DEFINER acotada por JWT que ya actualiza last_seen_at/
-- app_version), y la lee el panel admin (`listDevices`) para poblar el <select>.

alter table public.devices add column printers text[] not null default '{}';

-- Se AMPLÍA `device_heartbeat` con un segundo parámetro `p_printers`. La firma cambia, así que
-- se elimina la anterior y se recrea: `p_printers` lleva DEFAULT null para que un agente viejo
-- (que aún llama con un solo argumento) siga funcionando sin ambigüedad de sobrecarga. Igual
-- que con app_version, se usa `coalesce(p_printers, printers)` -> un heartbeat sin lista (p. ej.
-- fuera de Electron, o si enumerar las impresoras falló ese tick) NO borra las ya reportadas.
drop function if exists public.device_heartbeat(text);

create or replace function public.device_heartbeat(p_app_version text, p_printers text[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.devices
     set last_seen_at = now(),
         app_version = coalesce(p_app_version, app_version),
         printers = coalesce(p_printers, printers)
   where auth_user_id = auth.uid();
end;
$$;

revoke execute on function public.device_heartbeat (text, text[]) from anon, public;
grant execute on function public.device_heartbeat (text, text[]) to authenticated;
