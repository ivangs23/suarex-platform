-- SUPERADMINS DE LA PLATAFORMA (el equipo de SuarEx), separados A PROPÓSITO de `memberships`.
--
-- Por qué no un rol 'platform' dentro de memberships: el `custom_access_token_hook` inyecta
-- `tenant_id` y `tenant_role` en el access token a partir de la PRIMERA membership del
-- usuario. Un rol de plataforma metido ahí viajaría dentro del mismo claim que los roles de
-- tenant, y quedaría a un `if` mal escrito de distancia de confundirse con uno. Con la tabla
-- separada, un superadmin NO tiene ninguna membership, así que su JWT no lleva `tenant_id` en
-- absoluto y `resolveStaffSession` lo rechaza por construcción en cualquier superficie de
-- cliente, sin depender de ninguna comprobación añadida.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

-- RLS activada y SIN NINGUNA POLICY: no hay fila que devolver para nadie que no sea
-- `service_role`. El único acceso es `packages/db/src/platform.ts`, detrás de
-- `requirePlatformAdmin`.
alter table public.platform_admins enable row level security;

-- El revoke NO es redundante con la RLS de arriba, y por eso lo lleva TODA tabla de este
-- esquema (core_tenancy:152, catalog:118, tables:113, orders:88, devices_printers:138...):
-- los privilegios por defecto del stack conceden `arwdDxtm` sobre cada tabla nueva de `public`
-- a anon y authenticated (verificable en `pg_default_acl`). RLS filtra FILAS; el GRANT es lo
-- que decide si el rol puede siquiera nombrar la tabla. Mismo patrón que `pair_attempts` y
-- `rate_limit_hits`, las otras dos tablas sin dueño de tenant.
revoke all on public.platform_admins from anon, authenticated;

comment on table public.platform_admins is
  'Equipo de SuarEx. Solo service_role. Un superadmin NO tiene membership: su JWT no lleva tenant_id.';
