-- Modo totem, Fase 3: tras aprobar el cobro por Paytef, el device (totem) marca su pedido
-- kiosko como pagado. El rol `device` NO puede hacer UPDATE sobre `orders` (orders_update lo
-- excluye, 20260722000005), así que esto va por una RPC SECURITY DEFINER acotada: SOLO marca un
-- pedido del PROPIO tenant del device, del canal `kiosko`, y que esté en `pending`. Nunca puede
-- tocar un pedido de otro tenant, de otro canal (el QR paga por Stripe), ni re-marcar uno ya
-- pagado. Mismo patrón de aislamiento por JWT que `reserve_printed_self`/`device_heartbeat`.
create or replace function public.mark_kiosko_order_paid(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_updated int;
begin
  select d.tenant_id into v_tenant
  from public.devices d
  where d.auth_user_id = auth.uid();
  if v_tenant is null then
    return false; -- quien llama no es un device emparejado
  end if;

  update public.orders
     set status = 'paid', paid_at = now()
   where id = p_order_id
     and tenant_id = v_tenant
     and channel = 'kiosko'
     and status = 'pending';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.mark_kiosko_order_paid (uuid) from anon, public;
grant execute on function public.mark_kiosko_order_paid (uuid) to authenticated;
