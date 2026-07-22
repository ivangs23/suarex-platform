-- Emoji identificativo de cada categoría de la carta (🍷 para vinos, ☕ para cafés...).
--
-- No es decoración prescindible: en una carta que se navega por niveles, el icono es lo que
-- permite reconocer una categoría de un vistazo antes de leerla, que es justo como se usa
-- una carta en una mesa. La carta real de Garum lo tiene en las 59 categorías.
--
-- `text` y no un `char`/enum: un emoji puede ocupar varios puntos de código (🏳️‍🌈, 👨‍🍳) y
-- cualquier lista cerrada de iconos quedaría corta en cuanto entre un cliente de otro tipo
-- de negocio. La longitud se acota en el borde de escritura, no aquí.
--
-- Nullable a propósito: una categoría sin icono es perfectamente válida y el tema
-- simplemente no pinta nada. Poner un icono por defecto obligaría a elegir uno que no
-- significa nada para el negocio del cliente.
alter table public.categories
  add column if not exists icon text;
