-- Traducciones al portugués de los 14 alérgenos globales de la UE.
--
-- La carta ya se sirve en pt (idioma soportado, ver `apps/web/lib/i18n.ts`), pero los
-- alérgenos globales solo traían es/en (`20260721000002_catalog.sql`): un comensal en
-- portugués veía los platos en pt y sus alérgenos en inglés. Equivocarse con un alérgeno es
-- un riesgo para el comensal, así que la traducción no es cosmética.
--
-- Se hace por UPDATE y no reescribiendo la migración original: esa ya está aplicada en
-- producción. Se emparejan por `icon`, que es único entre los globales (`tenant_id is null`),
-- y se FUSIONA el pt en el jsonb con `||` para no pisar el es/en que ya está.
update public.allergens as a
set name_i18n = a.name_i18n || jsonb_build_object('pt', t.pt)
from (values
  ('wheat',    'Glúten'),
  ('shrimp',   'Crustáceos'),
  ('egg',      'Ovos'),
  ('fish',     'Peixe'),
  ('peanut',   'Amendoins'),
  ('soy',      'Soja'),
  ('milk',     'Leite'),
  ('nut',      'Frutos de casca rija'),
  ('celery',   'Aipo'),
  ('mustard',  'Mostarda'),
  ('sesame',   'Sésamo'),
  ('sulphite', 'Sulfitos'),
  ('lupin',    'Tremoço'),
  ('mollusc',  'Moluscos')
) as t(icon, pt)
where a.tenant_id is null and a.icon = t.icon;
