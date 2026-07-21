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

revoke all on public.pg_tables_rls_check from anon, authenticated;
grant select on public.pg_tables_rls_check to service_role;
