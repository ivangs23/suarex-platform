-- Sistema de temas de la carta pública. Cada tenant elige un tema por slug
-- (`tenant_settings.theme`): 'generic' se pinta al 100% con el branding; los temas a medida
-- (p. ej. 'garum', 'manuela') son componentes codificados en la web. Default 'generic' para
-- que cualquier tenant, sin configurar nada, renderice una carta válida.
alter table public.tenant_settings
  add column if not exists theme text not null default 'generic';
