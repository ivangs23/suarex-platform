-- BARRIDO DE SALUD DE DISPOSITIVOS, ATÓMICO.
--
-- La primera versión traía TODAS las filas de dispositivos emparejados de TODOS los tenants y
-- decidía en JavaScript. Tres problemas encadenados:
--
--   1. El índice `devices_offline_sweep_idx` sobre `(last_seen_at) where paired_at is not null`
--      nunca se usaba: `last_seen_at` no entraba en el WHERE. El comentario que decía "el
--      barrido busca exactamente por aquí" era falso. Ahora sí lo es.
--   2. Leer-entonces-escribir en dos pasos deja una ventana: dos ejecuciones solapadas del
--      cron (cada 5 min, `curl -fsS` sin lock) veían ambas el mismo dispositivo como recién
--      caído y avisaban las dos. El UPDATE ... RETURNING es atómico: gana exactamente una.
--   3. La comparación se hacía entre cadenas ISO de dos productores distintos (PostgREST
--      devuelve `+00:00`, JavaScript produce `Z`). Funcionaba por accidente lexicográfico;
--      con otra zona horaria del cluster se habría desplazado horas en silencio. Aquí se
--      comparan timestamps de verdad.
--
-- Devuelve SOLO LAS TRANSICIONES, que es lo que el aviso necesita: un correo cada 5 minutos
-- durante una caída de dos horas son 24 correos, y después de eso el aviso de la caída
-- siguiente tampoco lo lee nadie.
create or replace function public.sweep_device_health(p_minutos int default 10)
returns table (device_id uuid, nombre text, tenant_slug text, ultimo_latido timestamptz, transicion text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limite timestamptz;
begin
  -- Falla cerrado: un 0 por descuido en el cron marcaría como caídos a TODOS los dispositivos
  -- vivos de la plataforma y mandaría un aviso por cada cliente.
  if p_minutos is null or p_minutos < 1 then
    raise exception 'El umbral debe ser de al menos 1 minuto (recibido: %)', p_minutos;
  end if;
  v_limite := now() - make_interval(mins => p_minutos);

  return query
  with caidos as (
    update public.devices d
       set offline_alerted_at = now()
      from public.tenants t
     where t.id = d.tenant_id
       and d.paired_at is not null
       and d.offline_alerted_at is null
       -- Sin latido desde el emparejamiento cuenta como caído: se instaló y no arrancó nunca,
       -- que es exactamente el caso que hay que ver.
       and (d.last_seen_at is null or d.last_seen_at < v_limite)
    returning d.id, d.name, t.slug, d.last_seen_at
  ),
  recuperados as (
    update public.devices d
       set offline_alerted_at = null
      from public.tenants t
     where t.id = d.tenant_id
       and d.paired_at is not null
       and d.offline_alerted_at is not null
       and d.last_seen_at is not null
       and d.last_seen_at >= v_limite
    returning d.id, d.name, t.slug, d.last_seen_at
  )
  select c.id, c.name, c.slug, c.last_seen_at, 'caido'::text from caidos c
  union all
  select r.id, r.name, r.slug, r.last_seen_at, 'recuperado'::text from recuperados r;
end;
$$;

revoke execute on function public.sweep_device_health (int) from public, anon, authenticated;
grant execute on function public.sweep_device_health (int) to service_role;
