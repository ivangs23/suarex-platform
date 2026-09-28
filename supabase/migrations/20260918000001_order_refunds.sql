-- REEMBOLSOS Y DISPUTAS.
--
-- Hasta ahora el webhook solo escuchaba `payment_intent.succeeded`: un reembolso hecho en el
-- dashboard de Stripe no llegaba nunca, y el pedido se quedaba `paid` para siempre. La base
-- mentía sobre el dinero, y nadie se enteraba salvo cuadrando a mano contra Stripe.
--
-- `refunded` entra en el CHECK de `status` como estado terminal, al lado de `cancelled`. NO se
-- reutiliza `cancelled`: un pedido cancelado nunca llegó a cobrarse (lo barre
-- `expire_pending_orders` cuando el comensal no paga), mientras que uno reembolsado SÍ se
-- cobró y se devolvió. Confundirlos perdería precisamente la información por la que existe
-- esta migración.
alter table public.orders
  drop constraint orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending', 'paid', 'preparing', 'served', 'cancelled', 'refunded'));

alter table public.orders
  -- Importe devuelto EN CÉNTIMOS, no euros: Stripe trabaja en la unidad mínima y convertir
  -- dos veces es donde aparecen los descuadres de un céntimo. Puede ser menor que el total
  -- (reembolso parcial), así que no se deriva de `total`.
  add column refunded_cents int check (refunded_cents is null or refunded_cents >= 0),
  add column refunded_at timestamptz,
  -- Una disputa NO es un reembolso: el dinero se retiene mientras el banco decide, y el
  -- pedido puede acabar cobrado igualmente. Se marca aparte para que el estado del pedido no
  -- mienta en ninguna de las dos direcciones.
  add column disputed_at timestamptz;

-- El barrido de conciliación busca por aquí: pedidos con dinero devuelto, por fecha.
create index orders_refunded_idx on public.orders (tenant_id, refunded_at)
  where refunded_at is not null;

comment on column public.orders.refunded_cents is
  'Importe devuelto en céntimos. Puede ser parcial. Lo escribe SOLO el webhook de pagos.';
