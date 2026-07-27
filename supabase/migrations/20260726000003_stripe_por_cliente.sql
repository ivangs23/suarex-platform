-- CREDENCIALES DE STRIPE POR CLIENTE.
--
-- El cobro del canal QR usa hoy tres variables de entorno globales: `STRIPE_SECRET_KEY`,
-- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` y `STRIPE_WEBHOOK_SECRET`. Con eso, TODOS los clientes
-- cobran contra la misma cuenta -- la de esa clave.
--
-- El código soporta además `tenants.stripe_account_id` y la cabecera `stripeAccount`, que es
-- maquinaria de Stripe CONNECT: una plataforma con autoridad sobre cuentas conectadas. La
-- realidad de este producto es otra: cada cliente tiene su PROPIA cuenta, independiente, agrupada
-- solo para administrarla desde un mismo acceso. En ese modelo la clave de uno no manda sobre la
-- de otro, así que esa cabecera ni siquiera funcionaría -- daría error de permisos. Es código que
-- despista, porque hace parecer que basta con rellenar un campo.
--
-- Lo que hace falta de verdad es guardar las credenciales DE CADA CUENTA. Esta tabla lo hace, con
-- la misma forma que ya se probó para el datáfono (20260726000001): lo que se puede enseñar
-- aparte de lo que no vuelve nunca al navegador.
--
-- Tabla propia y no dentro de `tenant_payment_config` a propósito: aquélla describe un TERMINAL
-- DESATENDIDO presente en el local (ver el contrato en `payment-provider.ts`, que deja fuera las
-- pasarelas por diseño). Meter aquí una pasarela web sería forzar esa abstracción justo por donde
-- se dijo que no encajaba.
create table public.tenant_stripe_config (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  -- La clave PÚBLICA no es un secreto: su trabajo es bajar al navegador para montar el formulario
  -- de tarjeta. Por eso es columna y no va en `secrets`.
  publishable_key text,
  -- `secretKey` y `webhookSecret`. Nunca salen hacia el navegador: el panel solo informa de
  -- CUÁLES están puestos, igual que con el datáfono.
  secrets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tenant_stripe_config enable row level security;

-- Misma postura que `tenant_payment_config` tras 20260726000002: `authenticated` no tiene NINGÚN
-- privilegio. Ningún camino legítimo pasa por ahí -- el panel lee y escribe con el service role
-- (el rol se comprueba antes, en la Server Action) y el cobro y el webhook corren en el servidor.
-- Conceder el privilegio solo abriría la puerta a que una sesión de owner robada se llevara la
-- clave secreta de cobro del negocio.
--
-- La policy se conserva como defensa en profundidad: si alguien volviera a conceder el
-- privilegio, el aislamiento por tenant seguiría en pie en vez de quedar la tabla abierta.
create policy tenant_stripe_config_manage on public.tenant_stripe_config
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'))
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() in ('owner', 'admin'));

revoke all on public.tenant_stripe_config from anon, authenticated;
