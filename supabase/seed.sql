with t as (
  insert into public.tenants (slug, name, status) values
    ('garum', 'Garum Vinoteca', 'active'),
    ('manuela', 'Manuela Desayuna', 'active')
  returning id, slug
)
insert into public.tenant_settings (tenant_id, branding, locale, currency, channels)
select
  t.id,
  case t.slug
    when 'garum' then '{"colors":{"bg":"#d6e8d2","primary":"#7b4f96","accent":"#4a7860"}}'::jsonb
    else '{"colors":{"bg":"#fff8e7","primary":"#c28744","accent":"#2c1a0f"}}'::jsonb
  end,
  'es', 'EUR',
  case t.slug when 'garum' then array['qr-mesa'] else array['kiosko'] end
from t;

insert into public.venues (tenant_id, slug, name, is_default)
select id, 'principal', 'Principal', true from public.tenants where slug in ('garum', 'manuela');

insert into public.categories (tenant_id, slug, name_i18n, destination, sort_order)
select id, 'vinos', '{"es":"Vinos","en":"Wines"}'::jsonb, 'barra', 0
  from public.tenants where slug = 'garum'
union all
select id, 'tostas', '{"es":"Tostas","en":"Toasts"}'::jsonb, 'cocina', 0
  from public.tenants where slug = 'manuela';

insert into public.products (tenant_id, category_id, name_i18n, price, sort_order)
select c.tenant_id, c.id, '{"es":"Ribera del Duero","en":"Ribera del Duero"}'::jsonb, 18.00, 0
  from public.categories c join public.tenants t on t.id = c.tenant_id
 where t.slug = 'garum'
union all
select c.tenant_id, c.id, '{"es":"Tosta de jamón","en":"Ham toast"}'::jsonb, 4.50, 0
  from public.categories c join public.tenants t on t.id = c.tenant_id
 where t.slug = 'manuela';

insert into public.tables (tenant_id, venue_id, label, token, sort_order)
select v.tenant_id, v.id, m.label, m.token, m.sort_order
  from public.venues v
  join public.tenants t on t.id = v.tenant_id
  cross join (values
    ('1', '11111111-1111-1111-1111-111111111111'::uuid, 0),
    ('2', '22222222-2222-2222-2222-222222222222'::uuid, 1)
  ) as m(label, token, sort_order)
 where t.slug = 'garum';

-- Extra del vino de garum, para que `tests/e2e/qr-order.spec.ts` pueda demostrar que la
-- carta ofrece extras y que elegir uno suma su precio al total del carrito.
insert into public.product_extras (tenant_id, product_id, name_i18n, price)
select p.tenant_id, p.id, '{"es":"Copa extra","en":"Extra glass"}'::jsonb, 3.00
  from public.products p
  join public.tenants t on t.id = p.tenant_id
 where t.slug = 'garum';

-- Mesa de manuela: sin esto, `tests/e2e/staff-board.spec.ts` no podría crear un pedido
-- real para manuela por la API pública (`POST /api/orders` exige un `tableToken` válido,
-- ver `findTableByToken`) y su test de aislamiento (control positivo con dos tenants
-- reales) no tendría con qué probar que un pedido de manuela SÍ aparece en su propio
-- panel. El canal declarado de manuela en `tenant_settings` es `kiosko`, no `qr-mesa`,
-- pero `POST /api/orders` no distingue canales hoy (ver `apps/web/app/api/orders/route.ts`)
-- -- una mesa válida basta, sea cual sea el canal nominal del tenant.
insert into public.tables (tenant_id, venue_id, label, token, sort_order)
select v.tenant_id, v.id, '1', '33333333-3333-3333-3333-333333333333'::uuid, 0
  from public.venues v
  join public.tenants t on t.id = v.tenant_id
 where t.slug = 'manuela';
