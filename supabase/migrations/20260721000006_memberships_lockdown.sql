-- La pertenencia a un tenant y el rol dentro de él son decisiones de
-- administración, no datos que el propio usuario pueda editar. Sin esto, un
-- `staff` puede ascenderse a `owner` con un solo UPDATE y, al refrescar el
-- token, el hook de acceso le inyecta el claim nuevo.
--
-- Se revoca la escritura a `authenticated` por completo. Cuando exista el panel
-- de administración (sub-proyecto 5), las altas y cambios de rol pasarán por el
-- servidor con service role y comprobación explícita de permisos, no por
-- PostgREST directamente.

drop policy if exists memberships_isolation on public.memberships;

create policy memberships_read on public.memberships
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

revoke insert, update, delete, truncate on public.memberships from authenticated;
