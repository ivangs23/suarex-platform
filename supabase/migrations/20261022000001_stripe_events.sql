-- EVENTOS DE STRIPE YA PROCESADOS.
--
-- Stripe reintenta un webhook hasta recibir un 2xx y puede entregar el mismo evento más de una
-- vez. Los manejadores ya son idempotentes, pero sin registro cada reentrega vuelve a ejecutar
-- todo. Aquí se guarda el `event.id` de cada evento procesado CON ÉXITO: se escribe después de
-- procesar, no antes, para que un fallo a medias no deje el evento marcado y el reintento de
-- Stripe se descarte como duplicado (ver las rutas de `apps/web/app/api/webhook/stripe`).
--
-- `tenant_id` es NULO cuando el webhook no sabe de quién es el evento (la ruta del entorno, común
-- a todos los negocios): es un registro técnico de la plataforma, no un dato de un cliente. Lleva
-- RLS y una policy canónica como cualquier tabla con `tenant_id`, pero `authenticated` no tiene
-- ningún privilegio: solo escribe el service role, igual que `tenant_payment_config`. Así
-- `tests/integration/tenant-isolation.test.ts` la descubre y la exige cerrada.
--
-- Retención: `purgeStripeEvents` (cron de `purge-orders`) borra los de más de 90 días. Stripe no
-- reintenta un evento más allá de 3 días, así que pasado ese plazo no protegen de nada.

create table public.stripe_events (
  id text primary key,
  tenant_id uuid null references public.tenants (id) on delete cascade,
  type text not null,
  received_at timestamptz not null default now()
);

create index stripe_events_received_at_idx on public.stripe_events (received_at);

alter table public.stripe_events enable row level security;

create policy stripe_events_tenant on public.stripe_events
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

revoke all on public.stripe_events from anon, authenticated;
