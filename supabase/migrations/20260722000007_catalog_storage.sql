-- Bucket de imágenes de catálogo. Público en LECTURA (las fotos de la carta las
-- ve cualquier comensal), pero la ESCRITURA solo por el servidor con service
-- role: el navegador nunca sube directamente. Las rutas son tenant/{id}/... así
-- que un objeto pertenece siempre a un tenant identificable.
insert into storage.buckets (id, name, public)
values ('catalog', 'catalog', true)
on conflict (id) do nothing;

-- Sin policies de INSERT/UPDATE/DELETE para anon/authenticated: solo el service
-- role (que las salta) escribe. La lectura pública la da `public = true`.
