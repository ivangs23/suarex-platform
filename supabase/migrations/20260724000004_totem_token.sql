-- Modo totem, Fase 4: token de acceso del totem. La ventana kiosko del agente carga
-- `https://<tenant>/totem/<token>`; ese token resuelve tenant+venue del dispositivo (como el
-- token de mesa de `/m/<token>` resuelve la mesa), y deja `canOrder` a true SIN cookie de QR --
-- estás físicamente ante el datáfono, no hace falta la prueba de la cookie de mesa.
--
-- Estable (a diferencia del `pairing_code`, efímero y de un solo uso) y por dispositivo: cada
-- totem tiene el suyo. Se genera para TODOS los devices; solo los de rol `kiosko` lo usan.
alter table public.devices add column totem_token uuid not null default gen_random_uuid();

create unique index devices_totem_token_idx on public.devices (totem_token);
