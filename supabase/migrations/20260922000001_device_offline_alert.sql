-- AVISO DE DISPOSITIVO CAÍDO.
--
-- `device_heartbeat` ya escribía `last_seen_at` desde C2a, pero nadie lo leía: un PC apagado
-- se descubría cuando la cocina se quedaba sin comandas.
--
-- `offline_alerted_at` existe para avisar SOLO EN LAS TRANSICIONES. Sin ella, el barrido
-- avisaría cada 5 minutos mientras el dispositivo siga caído, y un aviso repetido durante una
-- caída larga se convierte en ruido que se acaba ignorando -- que es peor que no avisar. Es el
-- mismo criterio que ya usa el agente de escritorio para las impresoras (notifica cuando cae y
-- cuando vuelve, no mientras está caída) y el chequeo de uptime.
alter table public.devices
  add column offline_alerted_at timestamptz;

-- Emparejados y sin latir desde hace rato: el predicado del barrido.
--
-- Ojo al historial, porque explica por qué este comentario es preciso y no una promesa: la
-- PRIMERA versión del barrido traía todas las filas y filtraba en JavaScript, así que
-- `last_seen_at` no aparecía en ningún WHERE y este índice era inusable por construcción.
-- Desde `20260922000003_device_health_sweep.sql` el filtro vive en SQL y el planificador
-- puede usarlo (verificado con EXPLAIN forzando enable_seqscan=off: Bitmap Heap Scan sobre
-- este índice). Con la tabla casi vacía elige Seq Scan, que es lo correcto.
-- `paired_at is not null` en el índice porque un dispositivo sin emparejar nunca ha estado
-- vivo: avisar de que "no late" sería avisar de que todavía no se ha instalado.
create index devices_offline_sweep_idx on public.devices (last_seen_at)
  where paired_at is not null;

comment on column public.devices.offline_alerted_at is
  'Cuándo se avisó de que este dispositivo estaba caído. Se limpia al volver. Solo lo escribe el barrido de salud.';
