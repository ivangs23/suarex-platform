-- REEMBOLSOS, DE FORMA ATÓMICA Y CORRECTA CON LOS PARCIALES.
--
-- La primera versión guardaba el importe con una guarda `refunded_at is null`, y eso anulaba
-- la razón misma por la que se escucha `charge.refunded` en vez de `refund.created`: el
-- primero trae `amount_refunded` ACUMULADO. Con aquella guarda, el segundo reembolso parcial
-- (acumulado mayor) no actualizaba nada. Devolver 5 € y luego 10 € más dejaba la base
-- diciendo 5 €: no doble-contaba, SUB-contaba, que en conciliación es peor porque no se ve.
--
-- Aquí la idempotencia va contra el IMPORTE, no contra la fecha:
--   - reintento del mismo evento  -> p_refunded_cents = refunded_cents -> no actualiza
--   - reembolso parcial posterior -> p_refunded_cents > refunded_cents -> sí actualiza
--
-- Y el estado solo pasa a 'refunded' cuando se ha devuelto TODO. Un reembolso parcial no
-- puede tirar la comanda entera del tablero de cocina (`listActiveOrders` filtra ese estado)
-- ni pisar `preparing`/`served`, que se perdería de forma irreversible: devolver un plato de
-- cuatro no significa que la cocina deje de preparar los otros tres.
--
-- SECURITY DEFINER porque el webhook no conoce el tenant -- Stripe no sabe nada de tenants --
-- y localiza por `stripe_payment_intent_id`, que tiene índice único global.
create or replace function public.record_order_refund(
  p_payment_intent_id text,
  p_refunded_cents int
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_total_cents int;
  v_ya int;
begin
  if p_refunded_cents is null or p_refunded_cents < 0 then
    raise exception 'El importe reembolsado no puede ser negativo (recibido: %)', p_refunded_cents;
  end if;

  select o.id, round(o.total * 100)::int, coalesce(o.refunded_cents, 0)
    into v_id, v_total_cents, v_ya
    from public.orders o
   where o.stripe_payment_intent_id = p_payment_intent_id
     for update;

  if v_id is null then
    return 'order-not-found';
  end if;

  -- Acumulado igual o menor: es un reintento de Stripe, o un evento que llega desordenado.
  -- En ninguno de los dos casos se toca nada.
  if p_refunded_cents <= v_ya then
    return 'ya-registrado';
  end if;

  update public.orders
     set refunded_cents = p_refunded_cents,
         -- `refunded_at` marca el PRIMER reembolso y no se mueve con los siguientes: es la
         -- fecha en que este pedido empezó a devolverse.
         refunded_at = coalesce(refunded_at, now()),
         status = case
                    when p_refunded_cents >= v_total_cents then 'refunded'
                    else status
                  end
   where id = v_id;

  return 'registrado';
end;
$$;

revoke execute on function public.record_order_refund (text, int) from public, anon, authenticated;
grant execute on function public.record_order_refund (text, int) to service_role;
