-- Fix round 2 (revisión del task 4, Finding 1 y Finding 3).
--
-- Finding 1: `markStationDone` (`packages/db/src/staff-orders.ts`) hacía dos UPDATEs
-- independientes -- uno resolvía la estación, y solo si ESE tenía éxito, un segundo
-- UPDATE pasaba `status` a `served`. Si el proceso moría entre los dos (red, timeout,
-- error transitorio de la base), el pedido quedaba con ambas estaciones resueltas pero
-- `status` sin llegar nunca a `served`. Reintentar era un no-op garantizado: la guarda
-- `.eq(columna, 'pending')` del primer UPDATE ya no encontraba fila (la estación había
-- quedado en `done` en el intento anterior) y la función devolvía sin volver a evaluar
-- si tocaba servir. El pedido quedaba varado en el tablero para siempre, sin ningún
-- botón que lo resolviera.
--
-- Este trigger mueve esa decisión a la base de datos: cualquier UPDATE sobre una fila
-- de `orders` reevalúa, DENTRO de la misma sentencia, si las dos estaciones ya están
-- resueltas y, si corresponde, deja `status = 'served'` en el mismo movimiento. No
-- puede quedar a medias porque ya no hay una "segunda sentencia" -- solo hay una, y
-- `markStationDone` pasa a ser un único UPDATE (ver ese fichero).
--
-- Finding 3 (decisión de producto): un pedido no debe pasar a `served` mientras no esté
-- pagado. `status = 'pending'` significa que el webhook de Stripe todavía no ha
-- confirmado el cobro; el personal puede marcar estaciones por adelantado sobre un
-- pedido así (preparar antes de que el comensal pague en mesa), pero el pedido se queda
-- ahí -- ni `pending` ni `cancelled` avanzan solos a `served` -- hasta que el pedido
-- queda `paid` (o, más adelante, `preparing`). Como el trigger reevalúa en CADA UPDATE,
-- no solo en los que tocan las estaciones, el propio UPDATE que el webhook hace para
-- marcar `paid` (`markOrderPaid`, `packages/db/src/orders.ts`) sirve el pedido en el
-- acto si las estaciones ya estaban resueltas de antemano -- sin necesidad de ningún
-- paso adicional.
create or replace function public.orders_auto_serve()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Ambas estaciones fuera de 'pending' (cada una 'done' o 'na') Y al menos una
  -- realmente 'done' -- un pedido con las dos estaciones 'na' no tiene líneas reales y
  -- no debe autoservirse. Solo se plantea la transición cuando el pedido está en un
  -- estado "pagado en adelante" (paid o preparing); nunca desde pending ni cancelled,
  -- y es un no-op si ya está served (el status objetivo no cambia).
  if new.status in ('paid', 'preparing')
    and new.kitchen_status <> 'pending'
    and new.bar_status <> 'pending'
    and (new.kitchen_status = 'done' or new.bar_status = 'done')
  then
    new.status := 'served';
  end if;

  return new;
end;
$$;

create trigger orders_auto_serve before update on public.orders
  for each row execute function public.orders_auto_serve();
