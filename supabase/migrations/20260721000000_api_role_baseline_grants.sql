-- Baseline de privilegios de los roles de la API de Supabase (anon, authenticated,
-- service_role) que el stack de Supabase concedía IMPLÍCITO y las versiones nuevas ya no.
--
-- El resto de migraciones de este repo da ese baseline por hecho y solo lo ENDURECE
-- (`revoke all ... from anon`, `revoke execute ... from public`, etc.). Históricamente
-- funcionaba porque Supabase configuraba las DEFAULT PRIVILEGES del rol `postgres` en el
-- esquema `public` para conceder todo a anon/authenticated/service_role, y estas
-- migraciones (que corren como `postgres`, tanto en local con `supabase db reset` como en
-- el VPS vía deploy/scripts/apply-migrations.sh) heredaban esa concesión antes de revocar.
--
-- Las versiones recientes del stack ("secure by default") dejaron de conceder DML/EXECUTE
-- por defecto a lo que crea `postgres`: la default privilege de `postgres` sobre `public`
-- pasó a `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) sin SELECT/INSERT/UPDATE/DELETE.
-- Con ese cambio, los `revoke` de endurecimiento pasan a partir de "sin permiso" y cada
-- tabla del dominio queda inaccesible hasta para `service_role` -> el comensal anónimo
-- (packages/db, service role) y los paneles (authenticated) dejan de ver nada. Detalle en
-- docs/HANDOFF.md.
--
-- Por eso este fichero lleva el timestamp MÁS BAJO del repo: restaura el baseline ANTES de
-- que se creen las tablas/funciones, de modo que los revoke/grant de las migraciones
-- siguientes operen sobre exactamente el mismo punto de partida que la máquina original.
--
-- Se usa SOLO `alter default privileges` (objetos FUTUROS), nunca un `grant ... on all
-- tables in schema` sobre lo ya existente. Razón: en una base YA migrada (el VPS, hoy sobre
-- el stack viejo) esta migración corre después de que todas las tablas existan; un
-- `grant on all` reabriría el `anon` que las migraciones revocaron a propósito. Con
-- `alter default privileges` es un no-op sobre lo existente y solo fija el comportamiento
-- para lo que se cree de aquí en adelante -> seguro en ambos caminos.
--
-- Conceder por defecto a `anon` NO es una fuga: cada migración termina con su
-- `revoke all ... from anon` y la suite anti-fuga (`pg_anon_grants_check`, en
-- 20260721000003_test_introspection.sql) verifica tabla por tabla, descubierta en runtime,
-- que ningún `anon` quede con acceso. Este baseline restaura justo la condición que esa
-- suite fue diseñada para vigilar.

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;
