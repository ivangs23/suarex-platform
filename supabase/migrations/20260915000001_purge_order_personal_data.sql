-- RETENCIÓN DE DATOS DEL COMENSAL.
--
-- La política de privacidad que se publica al comensal (ver apps/web/lib/legal-content.ts)
-- promete dos plazos. Esta función los ejecuta; sin ella la promesa es falsa.
--
--   1. `order_items.notes` a los 90 días. Es el ÚNICO campo de texto libre que escribe el
--      comensal, y por tanto el único donde puede acabar un dato personal que nadie pidió
--      ("para la alérgica", "mesa de Marta"). Se ANULA el campo, no se borra la línea: el
--      restaurante conserva qué vendió.
--   2. El pedido entero a los 24 meses. `order_items`/`order_item_extras` caen por
--      `on delete cascade`.
--
-- SECURITY DEFINER y concedida SOLO a service_role: es mantenimiento de la plataforma, no una
-- operación de negocio de ningún tenant, y por eso NO filtra por tenant_id -- barre todos por
-- igual, que es justo lo que la retención exige.
create or replace function public.purge_order_personal_data(
  p_notes_days int default 90,
  p_orders_months int default 24
)
returns table (notas_borradas int, pedidos_borrados int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notas int;
  v_pedidos int;
begin
  -- Falla CERRADO ante un plazo no positivo. Un 0 por descuido en el cron -- o un valor
  -- vacío que Postgres interprete -- borraría el historial entero de todos los clientes de
  -- una sola pasada, sin vuelta atrás.
  if p_notes_days is null or p_orders_months is null
     or p_notes_days < 1 or p_orders_months < 1 then
    raise exception 'Los plazos de retención deben ser positivos (dias=%, meses=%)',
      p_notes_days, p_orders_months;
  end if;

  update public.order_items oi
     set notes = null
    from public.orders o
   where oi.order_id = o.id
     and oi.notes is not null
     and o.created_at < now() - make_interval(days => p_notes_days);
  get diagnostics v_notas = row_count;

  delete from public.orders
   where created_at < now() - make_interval(months => p_orders_months);
  get diagnostics v_pedidos = row_count;

  return query select v_notas, v_pedidos;
end;
$$;

revoke execute on function public.purge_order_personal_data (int, int) from public, anon, authenticated;
grant execute on function public.purge_order_personal_data (int, int) to service_role;
