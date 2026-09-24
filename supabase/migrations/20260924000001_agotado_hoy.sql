-- AGOTADO HOY, QUE SE RESTABLECE SOLO.
--
-- `is_available` ya existía y funciona, pero es PERMANENTE: hay que acordarse de reactivar el
-- plato, y nadie se acuerda. Al tercer día el producto sigue oculto y nadie sabe por qué.
--
-- Son dos conceptos distintos y por eso son dos columnas:
--   - `is_available = false`  -> FUERA DE CARTA. Decisión del dueño, indefinida, se revierte a
--                                mano. Un plato de temporada, uno que se deja de servir.
--   - `unavailable_until`     -> AGOTADO HOY. Se acabó el pulpo; mañana vuelve solo.
--
-- Fundirlos en un booleano con un cron que lo reactive tendría un fallo feo: al reactivar no
-- se podría distinguir un plato agotado de uno que el dueño había retirado a propósito, y el
-- cron devolvería a la carta cosas que nadie quería servir.
alter table public.products
  add column unavailable_until timestamptz;

comment on column public.products.unavailable_until is
  'Agotado HOY: oculto hasta esta hora, luego vuelve solo. Distinto de is_available=false, que es fuera de carta indefinidamente.';

-- La carta filtra por aquí en cada carga.
create index products_unavailable_until_idx on public.products (tenant_id, unavailable_until)
  where unavailable_until is not null;

-- ¿Hasta cuándo? Las 06:00 del día siguiente, EN LA ZONA DEL LOCAL.
--
-- No medianoche: un bar abierto hasta las 2:00 que marca el pulpo agotado a la 1:30 lo vería
-- reaparecer treinta minutos después, en pleno servicio. Las 06:00 caen después de cualquier
-- cierre y antes de cualquier apertura.
--
-- La zona sale de la sede por defecto del tenant (`venues.timezone`, 'Europe/Madrid' por
-- defecto) y no del servidor: un restaurante en Canarias marcaría agotado a una hora distinta
-- de la que cree.
create or replace function public.marcar_agotado_hoy(p_tenant_id uuid, p_product_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_hasta timestamptz;
begin
  select coalesce(v.timezone, 'Europe/Madrid') into v_tz
    from public.venues v
   where v.tenant_id = p_tenant_id
   order by v.is_default desc nulls last
   limit 1;
  v_tz := coalesce(v_tz, 'Europe/Madrid');

  v_hasta := ((((now() at time zone v_tz)::date + 1) + time '06:00') at time zone v_tz);

  update public.products
     set unavailable_until = v_hasta
   where id = p_product_id
     and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Producto % no encontrado en el tenant %', p_product_id, p_tenant_id;
  end if;

  return v_hasta;
end;
$$;

revoke execute on function public.marcar_agotado_hoy (uuid, uuid) from public, anon, authenticated;
grant execute on function public.marcar_agotado_hoy (uuid, uuid) to service_role;
