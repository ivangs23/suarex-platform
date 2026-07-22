-- Segunda RLS por rol del esquema, tras el rol `device` (000005). Las tablas de
-- CONFIGURACIÓN pasan a: lectura para todo el tenant, escritura solo para
-- owner/admin. Las tablas de OPERACIÓN (orders, order_items, order_item_extras)
-- NO se tocan: staff sigue operando el panel de comandas.
--
-- Patrón por tabla: se elimina la policy `for all` y se crea una de SELECT y una de
-- escritura (owner/admin). El predicado de tenant se conserva exactamente; solo se
-- AÑADE la condición de rol en el lado de escritura.
--
-- IMPORTANTE -- desviación deliberada del borrador original de esta tarea: el brief
-- describía el estado "hoy" como "toda policy es `for all ... using (tenant_id =
-- current_tenant_id())`, sin ninguna dimensión de rol", pero eso ya no es cierto tras
-- 20260722000005_device_rls_hardening.sql: `categories_isolation`, `products_isolation`,
-- `product_extras_isolation`, `allergens_read`/`allergens_write`, `tables_isolation` y
-- `venues_isolation` YA llevan `current_tenant_role() IS DISTINCT FROM 'device'` en su
-- SELECT (son tablas "categoría B" en 000005: el device no tiene ningún motivo para
-- verlas, ni lectura ni escritura). Copiar el SQL del brief tal cual (SELECT abierto
-- sin esa exclusión) habría REABIERTO la lectura de catálogo/mesas/venues a `device`,
-- deshaciendo en silencio el hardening de 000005 -- confirmado empíricamente: con el
-- SELECT sin exclusión, tres tests de `device-rls.test.ts` que hoy fallan con P0001
-- (el trigger `assert_same_tenant` no puede resolver el padre porque device no lo ve)
-- pasaban a fallar con 42501 (device SÍ veía el padre, y solo la policy de escritura
-- lo paraba) -- señal inequívoca de que el SELECT se había reabierto para ese rol.
-- Por eso el SELECT de las tablas categoría B de 000005 conserva aquí la exclusión de
-- `device` (usando exactamente la misma forma que 000005, ya permitida en
-- policy-check.ts); la escritura pasa a exigir `owner`/`admin`, lo que además de dejar
-- fuera a `staff` sigue dejando fuera a `device` (que tampoco es owner/admin).
-- `tenant_settings` es categoría A en 000005 (device SÍ necesita leer branding para
-- imprimir): su SELECT no se toca en absoluto aquí, solo su escritura.

-- ---- categories ----
drop policy categories_isolation on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy categories_write on public.categories
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- products ----
drop policy products_isolation on public.products;
create policy products_select on public.products
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy products_write on public.products
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- product_extras ----
drop policy product_extras_isolation on public.product_extras;
create policy product_extras_select on public.product_extras
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy product_extras_write on public.product_extras
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- allergens ----
-- La lectura ya admite los globales (tenant_id IS NULL) Y ya excluía a device (000005);
-- ambas condiciones se conservan tal cual. La escritura sigue exigiendo tenant_id =
-- current_tenant_id() (que excluye los NULL globales) MÁS el rol. Los 14 de la UE
-- quedan intocables por cualquier autenticado.
drop policy allergens_read on public.allergens;
drop policy allergens_write on public.allergens;
create policy allergens_select on public.allergens
  for select to authenticated
  using (
    (tenant_id is null or tenant_id = public.current_tenant_id())
    and public.current_tenant_role() is distinct from 'device'
  );
create policy allergens_write on public.allergens
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- tables ----
drop policy tables_isolation on public.tables;
create policy tables_select on public.tables
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy tables_write on public.tables
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- venues ----
drop policy venues_isolation on public.venues;
create policy venues_select on public.venues
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy venues_write on public.venues
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

-- ---- tenant_settings ----
-- Esta tabla NO tiene una policy `_isolation`: ya está separada por comando en cuatro
-- (tenant_settings_select/_insert/_update/_delete, confirmado contra la base local antes
-- de escribir estos DROP). Categoría A en 000005 (device SÍ lee branding para imprimir):
-- el SELECT se deja intacto, sin ninguna exclusión de rol. Se recrean las tres de
-- escritura como una sola `for all` que exige owner/admin -- sigue dejando fuera a
-- device (que tampoco es owner/admin), además de a staff.
drop policy tenant_settings_insert on public.tenant_settings;
drop policy tenant_settings_update on public.tenant_settings;
drop policy tenant_settings_delete on public.tenant_settings;
create policy tenant_settings_write on public.tenant_settings
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));
