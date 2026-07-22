-- C1, hardening de seguridad: hoy `staff`, `device`, `admin` y `owner` son idénticos a
-- nivel de datos -- toda policy de este proyecto es `for all ... using (tenant_id =
-- current_tenant_id())`, sin ninguna dimensión de rol. Un dispositivo (agente de
-- impresión) es una cuenta de servicio NO humana que corre en un barebone
-- físicamente accesible en el propio local: si lo roban y le extraen las credenciales,
-- hoy tienen CRUD completo sobre TODO el tenant (podrían borrar el menú, las mesas o los
-- pedidos). Esta migración lo acota a lo mínimo que necesita: leer lo necesario para
-- imprimir, y marcar impreso solo vía RPC.
--
-- Mecanismo: `custom_access_token_hook` (20260721000001_core_tenancy.sql) YA inyecta
-- `tenant_role` en el JWT desde `memberships.role` -- solo faltaba una función que lo
-- leyera desde dentro de una policy, igual que `current_tenant_id()` ya lee `tenant_id`.
--
-- Regla aplicada tabla a tabla (justificada una a una más abajo, y también en el informe
-- `.superpowers/sdd/device-rls-report.md`):
--   A) Tablas que un device SÍ necesita leer para construir un ticket (orders,
--      order_items, order_item_extras, printers, tenant_settings): se separa la policy
--      `for all` en un SELECT sin cambios (abierto a todo el tenant, como hoy) y policies
--      de escritura (INSERT/UPDATE/DELETE) que excluyen expresamente al rol device. El
--      predicado de aislamiento por tenant NO cambia en ningún caso -- solo se AÑADE la
--      exclusión de rol al lado de escritura.
--   B) Tablas que un device NO tiene ningún motivo para ver (catálogo, mesas, venues,
--      memberships, order_counters, tenants): se añade la misma exclusión de rol
--      directamente a la policy existente, en AMBOS lados (qual y with_check) -- device
--      queda fuera también de la lectura, no solo de la escritura.
--   C) `devices`: caso especial. El resto del tenant sigue viendo todas las filas (como
--      hoy); un device solo ve LA SUYA (`auth_user_id = auth.uid()`). La escritura queda
--      excluida por completo para device en esta ronda -- el "heartbeat"
--      (`last_seen_at`/`app_version` en su propia fila) queda DEFERRED: no es tan trivial
--      como pintaba (exige una forma de policy nueva atada a `auth.uid()` que además
--      habría que abrir SOLO para esas dos columnas, algo que RLS por filas no expresa
--      directamente sin una función auxiliar) y no es load-bearing para C1.
--
-- Ningún staff/admin/owner pierde nada: el predicado añadido es `current_tenant_role()
-- IS DISTINCT FROM 'device'`, que es `true` para cualquier rol que no sea exactamente
-- 'device' (incluido NULL, que cubre sesiones sin ese claim todavía).

create or replace function public.current_tenant_role()
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(
    current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_role',
    ''
  );
end;
$$;

-- ============================================================== reserve_printed_self
--
-- `reserve_printed(p_tenant_id, p_order_id, p_printer_id, p_at)`
-- (20260722000003_print_reservation.sql) es SECURITY DEFINER, pero CONFÍA en su
-- parámetro `p_tenant_id` sin comprobarlo contra ningún claim del llamante -- filtra con
-- `where tenant_id = p_tenant_id`, punto. Hoy está `revoke ... from anon, authenticated,
-- public; grant ... to service_role`, así que un device (que autentica como
-- `authenticated`) no puede llamarla en absoluto todavía.
--
-- Concedérsela tal cual a `authenticated` NO sería seguro: cualquier tenant podría
-- invocarla con el `p_tenant_id`/`order_id`/`printer_id` de OTRO tenant (si los conoce o
-- los adivina) y marcarle un pedido como impreso -- una escritura cross-tenant real, sin
-- que la propia función la impida. Por eso se crea este wrapper en vez de tocar la
-- función original (que además siguen usando, sin cambios, los callers de service role
-- vía `packages/db/src/print-jobs.ts` -> `reservePrintedRpc`): ignora cualquier tenant
-- que el llamante pudiera insinuar y usa SIEMPRE `current_tenant_id()` -- el claim del
-- PROPIO JWT del llamante, nunca un parámetro -- delegando el resto (merge atómico de
-- `printed_targets`, cálculo de cobertura por impresora) en la función original sin
-- duplicar esa lógica.
--
-- `current_tenant_id()` sigue resolviendo correctamente el tenant del llamante aquí
-- dentro pese a que esta función también es SECURITY DEFINER: los claims del JWT viven en
-- una GUC de sesión (`request.jwt.claims`, la fija PostgREST antes de ejecutar la
-- petición), no en el rol de ejecución -- SECURITY DEFINER cambia los privilegios con los
-- que se ejecuta la función, no esa GUC de sesión.
--
-- Se concede a `authenticated` en general (no solo a `device`): cualquier miembro del
-- propio tenant que la llame solo puede marcar pedidos DE SU PROPIO tenant, por
-- construcción -- no hay ángulo de abuso adicional en dejar que staff/admin/owner la usen
-- también, y no añade valor restringirla más solo por rol cuando el propio
-- `current_tenant_id()` ya la acota con seguridad.
create or replace function public.reserve_printed_self(
  p_order_id uuid,
  p_printer_id uuid,
  p_at text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reserve_printed(public.current_tenant_id(), p_order_id, p_printer_id, p_at);
end;
$$;

revoke execute on function public.reserve_printed_self (uuid, uuid, text) from anon, public;
grant execute on function public.reserve_printed_self (uuid, uuid, text) to authenticated;

-- ============================================================== categoría B: sin acceso
-- de device, ni lectura ni escritura (el device construye el ticket a partir de los
-- snapshots ya desnormalizados en order_items/order_item_extras -- ver
-- packages/ticket/src/build.ts y packages/db/src/print-jobs.ts -- nunca necesita leer
-- catálogo, mesas, venues, memberships, order_counters ni la fila de tenants).

drop policy categories_isolation on public.categories;
create policy categories_isolation on public.categories
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy products_isolation on public.products;
create policy products_isolation on public.products
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy product_extras_isolation on public.product_extras;
create policy product_extras_isolation on public.product_extras
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy allergens_read on public.allergens;
create policy allergens_read on public.allergens
  for select to authenticated
  using (
    (tenant_id is null or tenant_id = public.current_tenant_id())
    and public.current_tenant_role() is distinct from 'device'
  );

drop policy allergens_write on public.allergens;
create policy allergens_write on public.allergens
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy tables_isolation on public.tables;
create policy tables_isolation on public.tables
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy venues_isolation on public.venues;
create policy venues_isolation on public.venues
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy order_counters_isolation on public.order_counters;
create policy order_counters_isolation on public.order_counters
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

-- `tenants` se aísla por su propia `id`, no por `tenant_id` (ver `current_tenant_id()` y
-- `SELF_SCOPED_FORM` en policy-check.ts) -- mismo patrón de exclusión, distinta columna.
drop policy tenants_isolation on public.tenants;
create policy tenants_isolation on public.tenants
  for all to authenticated
  using (id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

-- `memberships` ya solo tiene una policy de SELECT (`memberships_read`,
-- 20260721000006_memberships_lockdown.sql) -- INSERT/UPDATE/DELETE/TRUNCATE están
-- revocados por completo a `authenticated` a nivel de GRANT, así que no hace falta
-- ninguna policy de escritura que excluir; solo se añade la exclusión de rol al SELECT.
drop policy memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

-- ============================================================== categoría A: lectura
-- abierta al tenant (sin cambios), escritura excluye a device. Postgres no admite un
-- único `for all` que cubra "INSERT/UPDATE/DELETE pero no SELECT", así que cada tabla de
-- este grupo pasa de 1 policy a 4 (select/insert/update/delete).

drop policy orders_isolation on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy orders_insert on public.orders
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy orders_update on public.orders
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy orders_delete on public.orders
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy order_items_isolation on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy order_items_insert on public.order_items
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy order_items_update on public.order_items
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy order_items_delete on public.order_items
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy order_item_extras_isolation on public.order_item_extras;
create policy order_item_extras_select on public.order_item_extras
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy order_item_extras_insert on public.order_item_extras
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy order_item_extras_update on public.order_item_extras
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy order_item_extras_delete on public.order_item_extras
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy printers_isolation on public.printers;
create policy printers_select on public.printers
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy printers_insert on public.printers
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy printers_update on public.printers
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy printers_delete on public.printers
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

drop policy tenant_settings_isolation on public.tenant_settings;
create policy tenant_settings_select on public.tenant_settings
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy tenant_settings_insert on public.tenant_settings
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy tenant_settings_update on public.tenant_settings
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
create policy tenant_settings_delete on public.tenant_settings
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

-- ============================================================== devices: caso especial
--
-- El resto del tenant (staff/admin/owner) sigue viendo TODAS las filas de `devices`, como
-- hoy -- sin cambio de comportamiento para ellos. Un device solo ve LA SUYA: dos policies
-- de SELECT permisivas (Postgres las combina con OR), una que cubre a "cualquiera que no
-- sea device" con el predicado de tenant de siempre, y otra que cubre "device, pero solo
-- su propia fila" vía `auth_user_id = auth.uid()`.
--
-- Escritura (INSERT/UPDATE/DELETE) queda excluida por completo para device en esta ronda
-- -- el "heartbeat" (actualizar `last_seen_at`/`app_version` en su propia fila) se
-- DIFIERE (ver nota de cabecera): no es load-bearing para C1.
drop policy devices_isolation on public.devices;

create policy devices_select_tenant on public.devices
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

create policy devices_select_own on public.devices
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'device'
    and auth_user_id = auth.uid()
  );

create policy devices_insert on public.devices
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

create policy devices_update on public.devices
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');

create policy devices_delete on public.devices
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() is distinct from 'device');
