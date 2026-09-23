-- EL AGENTE REPORTA SUS IMPRESORAS.
--
-- El nombre de la impresora USB se teclea a mano en el panel (`PrinterForm`), y un typo
-- significa que no imprime: en silencio, porque el agente busca un nombre que no existe y no
-- hay nada que falle de forma visible.
--
-- La solución NO puede ser que el panel pregunte al agente. El panel es una página web que
-- corre en el navegador del dueño, posiblemente en otra ciudad; solo el proceso Electron del
-- PC de cocina conoce sus impresoras. Y aunque el panel va incrustado en esa app, esa vista
-- NO tiene `preload` A PROPÓSITO (ver el docstring de `apps/agent-desktop/src/main/web-panel.ts`):
-- si heredara `window.agent.*`, un XSS en el panel podría des-emparejar el dispositivo o
-- disparar impresiones. Exponer IPC al contenido remoto rompería una garantía deliberada.
--
-- Así que viaja al revés: el agente REPORTA su lista en cada heartbeat y el panel la lee de la
-- base como cualquier otro dato.
alter table public.devices
  add column reported_printers text[];

comment on column public.devices.reported_printers is
  'Impresoras que el PC ve, reportadas por el agente en su heartbeat. Solo para ofrecerlas en el panel; la impresora real la decide `printers`.';

-- SE BORRA LA FUNCIÓN DE UN ARGUMENTO ANTES DE CREAR LA NUEVA.
--
-- `create or replace` con una firma distinta NO reemplaza: crea una SEGUNDA función, y
-- entonces PostgREST no puede resolver una llamada de un solo argumento y devuelve PGRST203
-- ("Could not choose the best candidate function"). El heartbeat dejaría de funcionar para
-- TODOS los agentes -- los viejos y los nuevos -- y las comandas dejarían de imprimirse.
-- Descubierto porque el test del heartbeat existente se puso rojo al añadir la sobrecarga.
--
-- Consecuencia operativa, y hay que tenerla presente al desplegar: durante la ventana entre
-- aplicar esta migración y actualizar los agentes, un agente VIEJO llama con un argumento
-- contra una función que ahora exige dos. Por eso el segundo lleva DEFAULT null: con el
-- default, la llamada de un argumento sigue resolviendo contra la función nueva.
drop function if exists public.device_heartbeat(text);

create function public.device_heartbeat(
  p_app_version text,
  p_printers text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.devices
     set last_seen_at = now(),
         app_version = coalesce(p_app_version, app_version),
         -- `coalesce` y no asignación directa: un agente que no reporta (versión vieja, o un
         -- fallo al enumerar) NO debe borrar la última lista buena. Perderla dejaría el
         -- desplegable vacío y al dueño otra vez tecleando a mano.
         reported_printers = coalesce(p_printers, reported_printers)
   where auth_user_id = auth.uid();
end;
$$;

revoke execute on function public.device_heartbeat (text, text[]) from anon, public;
grant execute on function public.device_heartbeat (text, text[]) to authenticated;
