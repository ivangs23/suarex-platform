-- Utilidad de introspección usada por la suite anti-fuga. Solo lectura de metadatos.
--
-- `public.tenants` NUNCA aparecía aquí: se aísla por su propia `id`, no por una
-- columna `tenant_id`, así que el descubrimiento original (`column_name =
-- 'tenant_id'`) la saltaba en silencio -- junto con ella, RLS-enabled, el
-- allowlist de forma de policy y las cuatro comprobaciones de comportamiento
-- cross-tenant, dejando sin cubrir la tabla que guarda `custom_domain`, `plan`,
-- `stripe_account_id` y `stripe_customer_id`. La segunda rama de este UNION
-- añade explícitamente las tablas "auto-delimitadas" (su propia `id` ES el
-- identificador de tenant); `tenants` es la única hoy, pero cualquier futura
-- tabla con esta misma forma debe añadirse aquí, no dejarse fuera del
-- descubrimiento.
create or replace function public.list_tenant_scoped_tables()
returns table (table_name text)
language sql
stable
set search_path = ''
as $$
  select c.table_name::text
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
   where c.table_schema = 'public'
     and c.column_name = 'tenant_id'
     and t.table_type = 'BASE TABLE'
  union
  select self_scoped.table_name from (values ('tenants')) as self_scoped (table_name)
  order by 1
$$;

grant execute on function public.list_tenant_scoped_tables () to service_role;
revoke execute on function public.list_tenant_scoped_tables () from anon, authenticated, public;

create or replace view public.pg_tables_rls_check
with (security_invoker = true)
as
  select c.relname as tablename, c.relrowsecurity as rowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r';

revoke all on public.pg_tables_rls_check from anon, authenticated, public;
grant select on public.pg_tables_rls_check to service_role;

-- Introspección de las policies mismas (qual/with_check), usada por la suite anti-fuga
-- para probar que ninguna policy fue degradada a `using (true)` / `with check (true)`.
-- Un test puramente comportamental no puede detectar esto en `products`/`product_extras`:
-- el trigger BEFORE `assert_same_tenant` (ver 20260721000002_catalog.sql) rechaza cualquier
-- INSERT cross-tenant antes de que la policy llegue a evaluar su WITH CHECK, así que la
-- suite vería el rechazo del trigger y pasaría igual aunque el WITH CHECK real estuviera roto.
create or replace view public.pg_policies_tenant_check
with (security_invoker = true)
as
  select
    n.nspname as schemaname,
    c.relname as tablename,
    pol.polname as policyname,
    case pol.polcmd
      when 'r' then 'SELECT'
      when 'a' then 'INSERT'
      when 'w' then 'UPDATE'
      when 'd' then 'DELETE'
      when '*' then 'ALL'
      else pol.polcmd::text
    end as cmd,
    pg_get_expr(pol.polqual, pol.polrelid) as qual,
    pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public';

revoke all on public.pg_policies_tenant_check from anon, authenticated, public;
grant select on public.pg_policies_tenant_check to service_role;

-- Introspección de los privilegios efectivos de `anon` sobre tablas de public. RLS
-- habilitada se auto-verifica ya (pg_tables_rls_check), pero un GRANT residual no: los
-- privilegios por defecto de Postgres re-conceden a `anon` en cada tabla nueva, y cada
-- migración de este proyecto termina con un `revoke all ... from anon` explícito que
-- alguien tiene que recordar escribir. Esta vista deja que la suite anti-fuga verifique
-- ese revoke sola, para cualquier tabla descubierta, hoy y en las que añadan los
-- subproyectos 2-6. `aclexplode(coalesce(relacl, acldefault(...)))` es el patrón estándar
-- de Postgres para leer el ACL efectivo de un objeto incluyendo el caso de ACL nula
-- (privilegios por defecto: solo el owner, nada para `anon`).
create or replace view public.pg_anon_grants_check
with (security_invoker = true)
as
  select
    c.relname as tablename,
    acl.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as acl
  where n.nspname = 'public'
    and c.relkind = 'r'
    and acl.grantee = (select oid from pg_roles where rolname = 'anon');

revoke all on public.pg_anon_grants_check from anon, authenticated, public;
grant select on public.pg_anon_grants_check to service_role;
