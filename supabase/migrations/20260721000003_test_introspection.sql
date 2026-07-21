-- Utilidad de introspección usada por la suite anti-fuga. Solo lectura de metadatos.
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
   order by c.table_name
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
