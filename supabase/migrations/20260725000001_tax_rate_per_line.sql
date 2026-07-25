-- IVA POR LÍNEA, no por ticket.
--
-- Hasta ahora el pedido llevaba un único tipo, el del tenant, aplicado a todo. En España eso
-- factura mal en cuanto un bar vende algo que no sea servicio de hostelería: el menú tributa al
-- 10 %, la botella que te llevas al 21 % y algunos alimentos al 4 %. Además, el desglose POR TIPO
-- es obligatorio en la factura (y lo será en el registro de facturación de Verifactu), así que el
-- tipo tiene que quedar congelado en cada línea, no deducirse después.
--
-- Resolución en tres escalones, del más concreto al más general:
--   1. `products.tax_rate`   -- excepción de un plato o artículo concreto
--   2. `categories.tax_rate` -- lo normal: una categoría "Tienda" al 21 %
--   3. `tenant_settings.fiscal.taxRate` -- el tipo de la casa (10 % en hostelería)
-- Ambas columnas son nulables porque "sin especificar" es justo lo que significa heredar.

alter table public.categories add column tax_rate numeric(5, 4)
  check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1));

alter table public.products add column tax_rate numeric(5, 4)
  check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1));

-- En la LÍNEA del pedido el tipo NO es nulable: para cuando se escribe ya está resuelto, y un
-- pedido histórico no puede cambiar de IVA porque alguien edite la carta después. Es un snapshot,
-- igual que `name_snapshot` y `unit_price`.
--
-- El default 0.10 solo sirve para poder añadir la columna a las filas que ya existen (todas ellas
-- se emitieron con el 10 % de hostelería, que era el único tipo posible hasta esta migración).
alter table public.order_items add column tax_rate numeric(5, 4) not null default 0.10
  check (tax_rate >= 0 and tax_rate <= 1);
