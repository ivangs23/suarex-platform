with t as (
  -- garum lleva `custom_domain` para poder ejercer en local la vía del dominio propio: es
  -- como su carta real (garumvinoteca.com/1) se serviría desde la plataforma conservando
  -- los QR ya impresos en sus mesas. Es un dominio de ejemplo a propósito -- `.test` está
  -- reservado por el RFC 2606 y no resuelve en internet, así que ningún test puede salir
  -- por error hacia el sitio real de un cliente.
  insert into public.tenants (slug, name, status, custom_domain) values
    ('garum', 'Garum Vinoteca', 'active', 'garum-demo.test'),
    ('manuela', 'Manuela Desayuna', 'active', null)
  returning id, slug
)
-- Marca real de cada cliente, extraída de sus frontends originales (ivangs23/GARUM-new y
-- ivangs23/web-manuela): garum es verde/morado con serif; manuela, crema/dorado. `theme`
-- elige el tema de la carta pública (ver apps/web/app/[mesa]/themes): ambos usan su tema A
-- MEDIDA; un cliente nuevo se queda con el default 'generic', que se pinta solo con estos
-- mismos colores sin necesidad de código.
insert into public.tenant_settings (tenant_id, branding, locale, currency, channels, theme)
select
  t.id,
  case t.slug
    when 'garum' then '{
      "name": "Garum Vinoteca",
      "colors": {"bg":"#d6e8d2","fg":"#111111","primary":"#7b4f96","accent":"#4a7860","muted":"#eef5ec"},
      "fonts": {"display":"Playfair Display","body":"Inter"},
      "logoUrl": null
    }'::jsonb
    else '{
      "name": "Manuela Desayuna",
      "colors": {"bg":"#f9f7f2","fg":"#2c1a0f","primary":"#c28744","accent":"#2c1a0f","muted":"#fff8e7"},
      "fonts": {"display":"Inter","body":"Inter"},
      "logoUrl": null
    }'::jsonb
  end,
  'es', 'EUR',
  case t.slug when 'garum' then array['qr-mesa'] else array['kiosko'] end,
  case t.slug when 'garum' then 'garum' else 'manuela' end
from t;

insert into public.venues (tenant_id, slug, name, is_default)
select id, 'principal', 'Principal', true from public.tenants where slug in ('garum', 'manuela');

-- Catálogo de muestra con volumen suficiente para que los temas de la carta se vean con
-- contenido real (varias categorías y productos por cliente). Los datos definitivos de
-- producción se importarán en su propio sub-proyecto.
insert into public.categories (tenant_id, slug, name_i18n, destination, sort_order)
select t.id, c.slug, c.name_i18n, c.destination, c.sort_order
  from public.tenants t
  cross join (values
    ('vinos',     '{"es":"Vinos","en":"Wines"}'::jsonb,          'barra',  0),
    ('entrantes', '{"es":"Entrantes","en":"Starters"}'::jsonb,   'cocina', 1),
    ('postres',   '{"es":"Postres","en":"Desserts"}'::jsonb,     'cocina', 2)
  ) as c(slug, name_i18n, destination, sort_order)
 where t.slug = 'garum'
union all
select t.id, c.slug, c.name_i18n, c.destination, c.sort_order
  from public.tenants t
  cross join (values
    ('tostas', '{"es":"Tostas","en":"Toasts"}'::jsonb,     'cocina', 0),
    ('cafes',  '{"es":"Cafés","en":"Coffee"}'::jsonb,      'barra',  1),
    ('dulces', '{"es":"Dulces","en":"Pastries"}'::jsonb,   'cocina', 2)
  ) as c(slug, name_i18n, destination, sort_order)
 where t.slug = 'manuela';

-- Segundo nivel de garum: su carta real es un ÁRBOL (Vinos → Tintos → botellas), no una
-- lista plana, así que el seed tiene que tener al menos un nivel anidado para que la
-- navegación por niveles de la carta sea demostrable en local. Va en un insert aparte
-- porque `parent_id` referencia filas creadas justo arriba.
insert into public.categories (tenant_id, slug, name_i18n, destination, sort_order, parent_id)
select t.id, c.slug, c.name_i18n, c.destination, c.sort_order, padre.id
  from public.tenants t
  cross join (values
    ('tintos',  '{"es":"Tintos","en":"Reds"}'::jsonb,     'barra', 0, 'vinos'),
    ('blancos', '{"es":"Blancos","en":"Whites"}'::jsonb,  'barra', 1, 'vinos')
  ) as c(slug, name_i18n, destination, sort_order, parent_slug)
  join public.categories padre
    on padre.tenant_id = t.id and padre.slug = c.parent_slug
 where t.slug = 'garum';

insert into public.products (tenant_id, category_id, name_i18n, price, sort_order)
select c.tenant_id, c.id, p.name_i18n, p.price, p.sort_order
  from public.categories c
  join public.tenants t on t.id = c.tenant_id
  join (values
    -- Los vinos cuelgan del segundo nivel (tintos/blancos), no de 'vinos': así la carta
    -- de garum en local tiene la misma forma de árbol que su carta real.
    ('tintos',    '{"es":"Ribera del Duero","en":"Ribera del Duero"}'::jsonb, 18.00, 0),
    ('tintos',    '{"es":"Rioja Crianza","en":"Rioja Crianza"}'::jsonb,       16.00, 1),
    ('blancos',   '{"es":"Albariño","en":"Albariño"}'::jsonb,                 15.50, 0),
    ('entrantes', '{"es":"Jamón ibérico","en":"Iberian ham"}'::jsonb,         22.00, 0),
    ('entrantes', '{"es":"Croquetas caseras","en":"Homemade croquettes"}'::jsonb, 9.50, 1),
    ('entrantes', '{"es":"Tabla de quesos","en":"Cheese board"}'::jsonb,      14.00, 2),
    ('postres',   '{"es":"Tarta de queso","en":"Cheesecake"}'::jsonb,          6.50, 0),
    ('postres',   '{"es":"Coulant de chocolate","en":"Chocolate coulant"}'::jsonb, 6.00, 1)
  ) as p(cat_slug, name_i18n, price, sort_order) on p.cat_slug = c.slug
 where t.slug = 'garum'
union all
select c.tenant_id, c.id, p.name_i18n, p.price, p.sort_order
  from public.categories c
  join public.tenants t on t.id = c.tenant_id
  join (values
    ('tostas', '{"es":"Tosta de jamón","en":"Ham toast"}'::jsonb,          4.50, 0),
    ('tostas', '{"es":"Tosta de aguacate","en":"Avocado toast"}'::jsonb,   5.20, 1),
    ('tostas', '{"es":"Tosta de salmón","en":"Salmon toast"}'::jsonb,      5.80, 2),
    ('cafes',  '{"es":"Café con leche","en":"Latte"}'::jsonb,              1.80, 0),
    ('cafes',  '{"es":"Cortado","en":"Cortado"}'::jsonb,                   1.50, 1),
    ('cafes',  '{"es":"Zumo natural","en":"Fresh juice"}'::jsonb,          3.20, 2),
    ('dulces', '{"es":"Croissant","en":"Croissant"}'::jsonb,               2.20, 0),
    ('dulces', '{"es":"Napolitana","en":"Chocolate pastry"}'::jsonb,       2.40, 1)
  ) as p(cat_slug, name_i18n, price, sort_order) on p.cat_slug = c.slug
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
 where t.slug = 'garum'
   and p.name_i18n->>'es' = 'Ribera del Duero';

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
