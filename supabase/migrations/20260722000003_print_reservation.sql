-- C1 task 4: reserva de impresión e idempotencia por impresora. `reserve_printed`
-- registra, de forma atómica, que UNA impresora concreta imprimió UN pedido, y fija
-- `printed_at` en cuanto TODAS las impresoras de destino del pedido quedan cubiertas.
--
-- Concurrencia (la parte delicada): dos llamadas simultáneas para impresoras DISTINTAS
-- del MISMO pedido no deben pisarse la entrada la una a la otra en `printed_targets`.
-- Un merge lectura-modificación-escritura hecho en dos sentencias separadas (SELECT
-- printed_targets, calcular en el cliente, UPDATE con el objeto entero) tiene una
-- ventana de carrera: dos llamadas pueden leer el mismo valor de partida, y la que
-- escribe segunda pisa el trabajo de la primera con datos ya obsoletos.
--
-- Aquí, en cambio, TODO el merge -- lectura del valor actual Y escritura del nuevo --
-- ocurre dentro de una única sentencia UPDATE (`printed_targets = case when ... else
-- printed_targets || jsonb_build_object(...) end`). Esa sentencia toma el lock de fila
-- de `orders` y lo mantiene hasta que la función (una única transacción implícita)
-- confirma. Si dos llamadas a `reserve_printed` compiten por el mismo pedido, Postgres
-- serializa esa fila bajo READ COMMITTED: la segunda queda bloqueada hasta que la
-- primera confirma, y en cuanto se desbloquea, su propio UPDATE relee el valor YA
-- confirmado por la primera (no una copia obsoleta) -- así que la segunda entrada se
-- añade sobre la primera en vez de reemplazarla. Ninguna de las dos entradas se pierde,
-- sin necesidad de un `SELECT ... FOR UPDATE` explícito: la propia sentencia UPDATE ya
-- actúa como su propio lock. Ver `tests/integration/print-jobs.test.ts`, test de
-- concurrencia, para la prueba con dos llamadas reales disparadas con `Promise.all` sin
-- await intermedio.
--
-- La misma sentencia además es idempotente por impresora: el `case when printed_targets
-- ? p_printer_id::text` no toca la entrada si esa impresora ya consta, así que llamar
-- dos veces con la misma impresora conserva el timestamp de la PRIMERA llamada, nunca
-- lo pisa con uno posterior.
--
-- Las "impresoras de destino" de un pedido son las habilitadas del mismo local (venue)
-- cuyo `destination` coincide con alguna estación que el pedido realmente usa
-- (`kitchen_status`/`bar_status` distinto de 'na', el mismo criterio con el que
-- `createPendingOrder` -- packages/db/src/orders.ts -- decide esas columnas) o que
-- están marcadas 'all' (imprimen cualquier pedido). Este cálculo se repite en
-- `packages/db/src/print-jobs.ts` (`unprintedPaidOrders`, en TypeScript) para decidir
-- qué pedidos aparecen como pendientes: ambas implementaciones deben mantenerse en
-- sync, ya que aquí decide cuándo se fija `printed_at` y allá decide cuándo un pedido
-- deja de listarse como pendiente.
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
  v_needed_destinations text[] := array[]::text[];
  v_needed_printer_ids uuid[];
  v_covered boolean;
begin
  -- Única sentencia: lee Y escribe `printed_targets` a la vez (ver razonamiento de
  -- concurrencia arriba). `where id = ... and tenant_id = ...` acota a exactamente
  -- el pedido de este tenant; si no existe (o es de otro tenant), `found` queda falso.
  update public.orders
     set printed_targets = case
           when printed_targets ? p_printer_id::text
             then printed_targets
           else printed_targets || jsonb_build_object(p_printer_id::text, p_at)
         end
   where id = p_order_id
     and tenant_id = p_tenant_id
  returning printed_targets, venue_id, kitchen_status, bar_status
    into v_targets, v_venue_id, v_kitchen_status, v_bar_status;

  if not found then
    return;
  end if;

  if v_kitchen_status is distinct from 'na' then
    v_needed_destinations := array_append(v_needed_destinations, 'cocina');
  end if;
  if v_bar_status is distinct from 'na' then
    v_needed_destinations := array_append(v_needed_destinations, 'barra');
  end if;

  select coalesce(array_agg(p.id), array[]::uuid[])
    into v_needed_printer_ids
    from public.printers p
   where p.tenant_id = p_tenant_id
     and p.venue_id = v_venue_id
     and p.enabled
     and (p.destination = 'all' or p.destination = any (v_needed_destinations));

  -- bool_and sobre un conjunto vacío (ninguna impresora de destino aplica) da NULL;
  -- coalesce a true trata "nada que imprimir" como trivialmente cubierto.
  select coalesce(bool_and(v_targets ? pid::text), true)
    into v_covered
    from unnest(v_needed_printer_ids) as pid;

  if v_covered then
    -- `printed_at is null` evita repisar: si ya estaba fijado (por una llamada
    -- anterior, o por otra reserva concurrente que ya vio la cobertura completa),
    -- esta sentencia no toca ninguna fila.
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
