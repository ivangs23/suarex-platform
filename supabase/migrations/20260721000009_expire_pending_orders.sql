-- Fase B, tarea 6: limpieza de pedidos `pending` abandonados.
--
-- Nota sobre el número de esta migración: el brief la nombraba
-- `20260721000008_expire_pending_orders.sql`, pero ese número ya lo ocupa
-- `20260721000008_orders_auto_serve.sql` (fase B, tarea 4). Se usa 000009, siguiente
-- hueco libre; los nombres de fichero de migración son únicamente orden de aplicación,
-- no un contrato con nadie fuera de este repositorio.
--
-- Un pedido `pending` que el comensal nunca paga (escaneó el QR, montó el carrito, y
-- cerró el navegador o se fue) se queda `pending` PARA SIEMPRE si nada lo toca -- ya
-- existía un caso parecido y ya resuelto (`cancelOrphanedPendingOrder` en
-- `packages/db/src/orders.ts`, para cuando el intento de cobro de Stripe falla justo
-- tras crear el pedido), con el mismo razonamiento que se repite aquí: NO se borra, se
-- marca `cancelled`. El histórico de intentos de pedido es información útil para el
-- personal/depuración, y borrar una fila que alguien pudo haber visto en un panel es
-- peor que conservarla marcada como lo que es: un intento que nunca llegó a buen puerto.
--
-- SOLO toca `pending`: cualquier pedido `paid`/`preparing`/`served`/ya `cancelled` se
-- deja intacto sin importar su antigüedad. Un pedido pagado hace horas y aún sin servir
-- es un problema operativo distinto (cocina/barra atascadas), no un abandono de carrito,
-- y esta función no lo toca.
--
-- Sin carrera real con un pago legítimo en vuelo: el ÚNICO camino que escribe
-- `status = 'paid'` es `markOrderPaid` (el webhook de Stripe con firma verificada,
-- `packages/db/src/orders.ts`), y ambos UPDATEs (el de esta función y el del webhook)
-- llevan `where status = 'pending'`. Si compiten por la misma fila, el que gane la
-- carrera de MVCC dictará el resultado y el que pierda sencillamente no encuentra ya la
-- fila en el estado `pending` que busca -- no hay forma de que un pedido recién pagado
-- termine `cancelled`, ni de que uno recién expirado "resucite" a `paid` por accidente
-- (si el pago se confirma DESPUÉS de que esta función ya lo canceló, `markOrderPaid`
-- tampoco encuentra fila `pending` y devuelve `order-not-found`, la misma señal ya
-- pensada para "no hay pedido que corresponda a este cobro" -- un caso a vigilar
-- operativamente, no un bug de esta función).
--
-- Tampoco pelea con `orders_auto_serve` (`20260721000008_orders_auto_serve.sql`): ese
-- trigger solo actúa cuando `new.status in ('paid', 'preparing')`. Esta función deja
-- `new.status = 'cancelled'`, así que la condición del trigger es falsa y no hace
-- nada -- un pedido que nunca se pagó no puede "autoservirse" al expirar, por
-- construcción (nunca pasó por `paid`/`preparing`, los únicos estados que el trigger
-- vigila).
create or replace function public.expire_pending_orders(p_timeout_minutes int default 30)
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  with expired as (
    update public.orders
    set status = 'cancelled'
    where status = 'pending'
      and created_at < now() - (p_timeout_minutes || ' minutes')::interval
    returning id
  )
  select id from expired;
$$;

-- Ningún rol de aplicación (anon/authenticated) tiene ni debe tener motivo para llamar
-- a esto directamente -- es una tarea de mantenimiento, no una operación de negocio
-- expuesta a un comensal ni al personal. Se concede a `service_role` para que
-- `tests/integration/expire-pending-orders.test.ts` pueda invocarla vía RPC con el
-- mismo cliente de servicio que usa el resto de la suite (el propietario, `postgres`,
-- ya puede ejecutarla sin necesidad de un grant explícito -- así es como la invoca
-- pg_cron más abajo).
revoke execute on function public.expire_pending_orders (int) from anon, authenticated, public;
grant execute on function public.expire_pending_orders (int) to service_role;

-- pg_cron: disponible en el stack local (`select * from pg_available_extensions where
-- name = 'pg_cron'` lo lista, y `shared_preload_libraries` ya lo precarga en la imagen
-- de Postgres de Supabase CLI -- comprobado antes de escribir esto), así que se activa
-- aquí. En un proyecto Supabase gestionado (staging/producción), pg_cron se habilita
-- desde el dashboard/API de integraciones del proyecto, no desde una migración de
-- esquema corriente -- si esta migración llegara a aplicarse contra un entorno donde la
-- extensión no está disponible, `create extension` fallaría ahí; el job y la función
-- viajan igualmente en el repositorio, listos para activarse en cuanto ese entorno
-- tenga la extensión, que es exactamente lo que pide el brief de esta tarea.
-- Sin cláusula `with schema`: el control file de pg_cron fija su propio esquema
-- (comprobado en el stack local -- pedir `with schema extensions` no cambia el
-- resultado, la extensión igualmente termina en `pg_catalog`; sus objetos de trabajo
-- -- `cron.job`, `cron.schedule()` -- viven en el esquema `cron` que la propia
-- extensión crea, aparte).
create extension if not exists pg_cron;

-- `cron.schedule` con un nombre de job ya existente actualiza ese job (upsert), no
-- lanza un error de duplicado -- comprobado en el stack local antes de confiar en
-- ello -- así que esta migración es reejecutable sin guardas adicionales.
select cron.schedule(
  'expire-pending-orders',
  '*/5 * * * *',
  $$select public.expire_pending_orders();$$
);
