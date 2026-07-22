-- Cierra el hueco heredado del canal QR: las policies de escritura de devices y
-- printers (creadas en 000005) solo excluían al rol `device`, de modo que un
-- `staff` podía crear/borrar dispositivos e impresoras. La gestión de la
-- infraestructura del local es cosa de owner/admin, igual que el catálogo (000006).
-- La LECTURA no cambia: staff y device siguen leyendo impresoras (device las
-- necesita para construir tickets); staff/owner/admin siguen viendo dispositivos.

-- ---- devices ----
-- 000005 creó devices_insert / devices_update / devices_delete, cada una excluyendo
-- solo 'device'. Se recrean exigiendo owner/admin. Nombres confirmados contra la base
-- local antes de escribir estos DROP:
--   select tablename, policyname, cmd from pg_policies where tablename='devices';
-- devices_select_own y devices_select_tenant (SELECT) NO se tocan.
drop policy devices_insert on public.devices;
drop policy devices_update on public.devices;
drop policy devices_delete on public.devices;
create policy devices_write on public.devices
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));
-- Nota: una policy `for all` write cubre también SELECT vía OR con las policies de
-- SELECT existentes (devices_select_tenant, devices_select_own), que NO se tocan, así
-- que la visibilidad por rol se conserva. Verificado tras aplicar (ver informe).

-- ---- printers ----
-- Mismo patrón. printers_select (tenant_id = current_tenant_id(), abierta a todo el
-- tenant incluido device) NO se toca.
drop policy printers_insert on public.printers;
drop policy printers_update on public.printers;
drop policy printers_delete on public.printers;
create policy printers_write on public.printers
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));
