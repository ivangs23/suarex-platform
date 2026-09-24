-- ESTADO DE LA SUSCRIPCIÓN DEL RESTAURANTE (lo que SuarEx le cobra a él, no lo que el comensal
-- paga por su comida -- eso vive en `orders.stripe_payment_intent_id`).
--
-- `tenants.plan` ya existía sin que nada lo leyera. Se conserva (es el NOMBRE del plan
-- contratado: 'free', 'basico', 'pro') y se le añade al lado el ESTADO de ese plan, que es lo
-- que decide si el servicio se sirve o se corta.

-- `stripe_customer_id` ya existía (20260721000001_core_tenancy.sql:13) pero SIN unicidad ni
-- índice. `applySubscriptionState` localiza el tenant por esa columna con `.maybeSingle()`, que
-- lanza PGRST116 si hubiera dos filas: la unicidad es lo que hace correcto ese camino, no una
-- comodidad. Parcial porque hoy casi todos los tenants la tienen a NULL.
create unique index tenants_stripe_customer_id_idx on public.tenants (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.tenants
  add column stripe_subscription_id text unique,
  add column plan_status text not null default 'trialing'
    check (plan_status in ('trialing', 'active', 'past_due', 'canceled')),
  add column trial_ends_at timestamptz,
  -- Hasta cuándo se sigue sirviendo a un tenant que ha dejado de pagar. NUNCA se corta en el
  -- momento del impago: un rechazo de tarjeta a las 14:30 dejaría sin carta a un comedor lleno,
  -- y el coste de eso es muy superior al de una semana de servicio regalado. El webhook abre la
  -- ventana; el barrido diario (`/api/internal/suspend-overdue`) la cierra.
  add column grace_until timestamptz;

-- El barrido de gracia vencida busca exactamente por este predicado.
create index tenants_grace_expiring_idx on public.tenants (grace_until)
  where grace_until is not null and status = 'active';

comment on column public.tenants.plan_status is
  'Estado de la suscripción en Stripe. Lo escribe SOLO el webhook de facturación; nadie lo edita a mano.';
