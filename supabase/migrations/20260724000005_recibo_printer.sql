-- Modo totem, Fase 5: el RECIBO DEL CLIENTE por la impresora del propio totem.
--
-- Un cuarto destino de impresora, `recibo`, para la impresora que saca el ticket del cliente (con
-- precios, IVA, total y código de recogida) -- distinto de las comandas de `cocina`/`barra`. Es
-- funcionalidad genérica: cualquier cliente puede configurar una impresora de recibo; el totem es
-- quien la usa. Un pedido de canal `kiosko` la NECESITA (como necesita cocina/barra según lo que
-- lleve); un pedido de canal `qr-mesa` no (el comensal tiene su recibo digital), así que una
-- impresora `recibo` no imprime pedidos de QR.
alter table public.printers drop constraint printers_destination_check;
alter table public.printers add constraint printers_destination_check
  check (destination in ('cocina', 'barra', 'all', 'recibo'));

-- `reserve_printed` decide cuándo un pedido queda del todo impreso (fija `printed_at`). Se
-- reescribe para que, en un pedido `kiosko`, la impresora de `recibo` cuente como impresora de
-- destino igual que cocina/barra: hasta que el recibo se imprime, el pedido sigue pendiente -- esa
-- es la red de seguridad at-least-once del recibo. La MISMA regla vive en TypeScript
-- (`targetPrinterIds`, packages/db/src/print-jobs.ts): ambas deben mantenerse en sync (test de
-- acuerdo en tests/integration/print-jobs.test.ts). Todo lo demás (merge atómico de
-- `printed_targets`, concurrencia, idempotencia, el trade-off "estación sin impresora ==
-- trivialmente cubierta") se conserva intacto respecto a 20260722000003_print_reservation.sql.
create or replace function public.reserve_printed(
  p_tenant_id uuid,
  p_order_id uuid,
  p_printer_id uuid,
  p_at text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_targets jsonb;
  v_venue_id uuid;
  v_kitchen_status text;
  v_bar_status text;
  v_channel text;
  v_needed_destinations text[] := array[]::text[];
  v_needed_printer_ids uuid[];
  v_covered boolean;
begin
  update public.orders
     set printed_targets = case
           when printed_targets ? p_printer_id::text
             then printed_targets
           else printed_targets || jsonb_build_object(p_printer_id::text, p_at)
         end
   where id = p_order_id
     and tenant_id = p_tenant_id
  returning printed_targets, venue_id, kitchen_status, bar_status, channel
    into v_targets, v_venue_id, v_kitchen_status, v_bar_status, v_channel;

  if not found then
    return;
  end if;

  if v_kitchen_status is distinct from 'na' then
    v_needed_destinations := array_append(v_needed_destinations, 'cocina');
  end if;
  if v_bar_status is distinct from 'na' then
    v_needed_destinations := array_append(v_needed_destinations, 'barra');
  end if;
  -- El recibo es obligatorio SOLO en el canal kiosko (el totem saca el ticket del cliente). En
  -- QR no aplica: una impresora `recibo` no debe retener un pedido de QR pendiente para siempre.
  if v_channel = 'kiosko' then
    v_needed_destinations := array_append(v_needed_destinations, 'recibo');
  end if;

  select coalesce(array_agg(p.id), array[]::uuid[])
    into v_needed_printer_ids
    from public.printers p
   where p.tenant_id = p_tenant_id
     and p.venue_id = v_venue_id
     and p.enabled
     and (p.destination = 'all' or p.destination = any (v_needed_destinations));

  select coalesce(bool_and(v_targets ? pid::text), true)
    into v_covered
    from unnest(v_needed_printer_ids) as pid;

  if v_covered then
    update public.orders
       set printed_at = p_at::timestamptz
     where id = p_order_id
       and tenant_id = p_tenant_id
       and printed_at is null;
  end if;
end;
$$;

revoke execute on function public.reserve_printed (uuid, uuid, uuid, text) from anon, authenticated, public;
grant execute on function public.reserve_printed (uuid, uuid, uuid, text) to service_role;
