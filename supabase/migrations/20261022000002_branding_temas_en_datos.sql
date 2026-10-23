-- GARUM Y MANUELA: DE TEMA DE CÓDIGO A DATOS.
--
-- La carta es un solo componente (`themes/generic.tsx`) y el aspecto de cada cliente es su
-- `branding`: colores, fuentes, tokens, ejes de layout y contenido. Ver
-- docs/superpowers/specs/2026-10-22-temas-data-driven-design.md.
--
-- Sus temas antiguos fijaban en el código colores, logo, textura, lema e insignia, e ignoraban
-- esos campos del branding. Aquí se escriben los MISMOS valores (medidos en su día sobre sus
-- webs y copiados de aquellos CSS), así que la carta se sigue viendo igual. Por eso se
-- SOBRESCRIBEN también `colors` y `logoUrl`: lo que hubiera ahí no se estaba pintando.
--
-- `||` mezcla en el primer nivel: `name` y cualquier otra clave del branding se conservan.
-- La foto de la bienvenida (`heroUrl`) ya era un ajuste del cliente: se respeta la que haya,
-- y solo Manuela, cuyo tema caía a su foto propia sin ajuste, la recibe si no tiene ninguna.
--
-- En un `db:reset` esto no toca nada (las migraciones corren antes que el seed, y el seed ya
-- inserta estos mismos valores).

update public.tenant_settings s
   set branding = s.branding || '{
         "colors": {"bg":"#d6e8d2","fg":"#111111","primary":"#7b4f96","accent":"#4a7860","muted":"#eef5ec"},
         "fonts": {"display":"playfair","body":"inter"},
         "logoUrl": "/brands/garum-logo.png",
         "tokens": {"surface":"#ffffff","radius":"lg","controlRadius":"pill","shadow":"soft","border":"thin","spacing":"comfortable","titles":"uppercase","imageFit":"cover","thumb":"md","cartIcon":"none"},
         "layout": {"welcome":"panel","hero":"card","nav":"back-button","categories":"icon-tiles","products":"list","langs":"code"},
         "background": {"imageUrl":"/brands/garum-pattern.svg","sizePx":150},
         "tagline": {"es":"Vinoteca & cocina de producto","en":"Wine bar & produce-led kitchen"},
         "badge": null
       }'::jsonb,
       theme = 'generic',
       updated_at = now()
  from public.tenants t
 where t.id = s.tenant_id
   and t.slug = 'garum';

update public.tenant_settings s
   set branding = s.branding || '{
         "colors": {"bg":"#f9f7f2","fg":"#2c1a0f","primary":"#c28744","accent":"#2c1a0f","muted":"#fff8e7"},
         "fonts": {"display":"playfair","body":"inter"},
         "logoUrl": "/brands/manuela-logo.png",
         "tokens": {"surface":"#ffffff","radius":"lg","controlRadius":"rounded","shadow":"medium","border":"thick","spacing":"compact","titles":"normal","imageFit":"contain","thumb":"sm","cartIcon":"bag"},
         "layout": {"welcome":"poster","hero":"none","nav":"title-pill","categories":"photo-tiles","products":"cards","langs":"flag"},
         "background": {"imageUrl":"/brands/manuela-terrazo.png","sizePx":916},
         "tagline": {},
         "badge": {"emoji":"☕","color":"#1b4d3e"}
       }'::jsonb
       || jsonb_build_object(
            'heroUrl',
            coalesce(nullif(s.branding -> 'heroUrl', 'null'::jsonb), '"/brands/manuela-fondo.png"'::jsonb)
          ),
       theme = 'generic',
       updated_at = now()
  from public.tenants t
 where t.id = s.tenant_id
   and t.slug = 'manuela';
