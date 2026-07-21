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
