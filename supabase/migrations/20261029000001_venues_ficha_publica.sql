-- Ficha pública de cada sede: dirección, teléfono y horario, lo que la carta enseña al
-- comensal y a los buscadores (plan 2026-10-29-visibilidad-de-la-carta, Fase 1). Columnas
-- nulas y sueltas: lo que el cliente no rellena no se publica, nunca se rellena por defecto.
-- Sin cambios de RLS: `venues_select`/`venues_write` (20260722000006) siguen excluyendo al
-- device, y estas columnas caen bajo las mismas políticas de fila.

alter table public.venues
  add column address_street text,
  add column address_postal_code text,
  add column address_city text,
  add column address_region text,
  add column phone text,
  add column opening_hours jsonb;

comment on column public.venues.opening_hours is
  'Horario semanal: {"mo": [["13:00","16:00"],["20:00","23:30"]], ..., "su": []}. Día ausente = no publicado; [] = cerrado. El formato fino (HH:MM, máx. dos tramos) se valida en la app.';

-- Solo la forma: claves de los siete días y, en cada uno, tramos [inicio, fin] de texto.
-- `strict`, porque en `lax` jsonpath desenvuelve las listas y no distingue un tramo de sus
-- dos horas; `silent`, para que un día que no es lista viole el check y no lance otro error.
alter table public.venues
  add constraint venues_opening_hours_forma check (
    opening_hours is null or (
      jsonb_typeof(opening_hours) = 'object'
      and opening_hours - array['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] = '{}'::jsonb
      and not jsonb_path_exists(opening_hours, 'strict $.* ? (@.type() != "array")', '{}', true)
      and not jsonb_path_exists(
        opening_hours, 'strict $.*[*] ? (@.type() != "array" || @.size() != 2)', '{}', true
      )
      and not jsonb_path_exists(
        opening_hours, 'strict $.*[*][*] ? (@.type() != "string")', '{}', true
      )
    )
  );
