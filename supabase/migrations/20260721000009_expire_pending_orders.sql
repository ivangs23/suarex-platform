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

-- pg_cron: activación CONDICIONADA a que la extensión esté realmente disponible, para
-- que esta migración se aplique limpiamente tanto si pg_cron está presente como si no.
-- `supabase db reset` aplica las migraciones como un lote todo-o-nada: si `create
-- extension pg_cron` fallara sin guarda, abortaría no solo esta migración sino TODAS
-- las posteriores -- en cualquier entorno donde pg_cron no esté precargado en
-- `shared_preload_libraries` (la imagen Docker de otro desarrollador, un bump de la
-- CLI/imagen, un runner de CI, un proyecto Supabase gestionado sin la extensión
-- habilitada todavía), un reset limpio rompería el esquema entero. El brief de esta
-- tarea pide exactamente esto: programar por pg_cron SI está disponible; si no, dejar
-- la función lista y documentar que el disparador se conecta en el despliegue.
--
-- Predicado de disponibilidad elegido: `pg_available_extensions` indica que la
-- extensión PUEDE instalarse (su control file está presente en el servidor), pero NO
-- garantiza que `create extension` vaya a tener éxito -- eso depende también de que
-- `shared_preload_libraries` la precargue, algo que solo se fija en el arranque de
-- Postgres y no es observable desde SQL antes de intentarlo. Por eso hay dos guardas,
-- no una: (1) el chequeo de `pg_available_extensions` evita ni intentarlo cuando la
-- extensión no existe en absoluto en el servidor, y (2) el propio bloque `create
-- extension`/`cron.schedule` va envuelto en su `exception when others`, que degrada a
-- un `NOTICE` cualquier fallo de activación que sobreviva a la guarda (1) -- por
-- ejemplo, "aparece en pg_available_extensions pero falta en
-- shared_preload_libraries", el caso exacto que este finding señala. Ninguna de las dos
-- guardas por sí sola cubre el problema completo; juntas sí.
--
-- Sin cláusula `with schema`: el control file de pg_cron fija su propio esquema
-- (comprobado en el stack local -- pedir `with schema extensions` no cambia el
-- resultado, la extensión igualmente termina en `pg_catalog`; sus objetos de trabajo
-- -- `cron.job`, `cron.schedule()` -- viven en el esquema `cron` que la propia
-- extensión crea, aparte).
--
-- Idempotencia: `cron.schedule` con un nombre de job ya existente actualiza ese job
-- (upsert por `jobname`), no lanza error de duplicado -- comprobado en el stack local
-- antes de confiar en ello -- así que reejecutar este bloque entero (otro `db reset`, o
-- reaplicar la migración) es seguro.
--
-- Si en los logs de un `db reset`/`db push` aparece "pg_cron scheduling skipped": la
-- extensión no quedó activa y el job NO quedó programado en ese entorno (el resto de
-- esta migración -- la función y sus grants -- sigue en vigor igualmente, sin depender
-- de esto). Hay que habilitar pg_cron para ese proyecto (dashboard/API de integraciones
-- en Supabase gestionado, o `shared_preload_libraries` + reinicio en un servidor
-- propio) y entonces ejecutar a mano, una vez, en el despliegue:
--   select cron.schedule('expire-pending-orders', '*/5 * * * *',
--     'select public.expire_pending_orders();');
do $pg_cron_activation$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;

      perform cron.schedule(
        'expire-pending-orders',
        '*/5 * * * *',
        $sql$select public.expire_pending_orders();$sql$
      );
    exception when others then
      raise notice 'pg_cron scheduling skipped: CREATE EXTENSION/cron.schedule failed (%). pg_cron figuraba en pg_available_extensions pero no se pudo activar (típicamente: ausente de shared_preload_libraries). Debe programarse a mano en el despliegue: select cron.schedule(''expire-pending-orders'', ''*/5 * * * *'', ''select public.expire_pending_orders();'');', sqlerrm;
    end;
  else
    raise notice 'pg_cron scheduling skipped: pg_cron no aparece en pg_available_extensions en este servidor. Debe programarse a mano en el despliegue, una vez la extensión esté habilitada: select cron.schedule(''expire-pending-orders'', ''*/5 * * * *'', ''select public.expire_pending_orders();'');';
  end if;
end;
$pg_cron_activation$;
