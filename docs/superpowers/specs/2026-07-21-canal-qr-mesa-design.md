# Sub-proyecto 2: Canal QR en mesa, de extremo a extremo

Fecha: 2026-07-21
Estado: aprobado, pendiente de plan de implementación

## Contexto

El sub-proyecto 1 dejó la fundación multitenant: esquema con `tenant_id` y RLS en todas las tablas, resolución de tenant por `Host`, theming desde base de datos, y una suite anti-fuga que descubre las tablas en tiempo de ejecución y rompe el build si alguna aparece sin políticas.

Sobre esa base, este sub-proyecto entrega el primer canal utilizable: un comensal escanea el QR de su mesa, pide desde su móvil, paga, y la comanda sale por la impresora térmica de la cocina.

### Por qué el canal y la impresión van juntos

La topología real de los locales obliga a ello. En Manuela conviven dos vías hacia las mismas impresoras:

- Un **tótem** táctil en la red local, donde el cliente pide y que saca él mismo las comandas.
- La **web con QR**, cuyos pedidos viajan a la nube y son impresos por el **programa instalado en el ordenador del local**.

Sin ese programa, un pedido hecho desde el móvil no llega a la cocina. Entregar el canal QR sin el agente de impresión produciría dos mitades que no sirven por separado, así que ambos forman un único sub-proyecto.

Esto confirma la decisión tomada en el sub-proyecto 1: **una sola app de escritorio con los papeles activables por configuración** (`kiosko`, `agente`, o ambos). Este sub-proyecto construye el papel de `agente`; el de `kiosko` llega en el sub-proyecto 4.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Alcance | Carta, carrito, cobro, panel de comandas e impresión física |
| Pagos | PaymentIntents de Stripe contra cuenta de test. Stripe Connect se aplaza al sub-proyecto 5 |
| Confirmación de pago | El webhook de Stripe es la única fuente de verdad |
| Carrito | En el navegador; el servidor recalcula los importes contra la base de datos al cobrar |
| Líneas de pedido | Tabla `order_items` con nombre y precio congelados en el momento de la compra |
| Acceso del personal | Una cuenta por local, sesión larga pensada para una tablet fija |
| Mesas | Tabla `tables` por local, con token no adivinable en el QR |
| Estado para el comensal | Seguimiento en vivo tras pagar |
| Tolerancia a caídas de red | No se pierde ningún pedido ya cobrado |
| Instalación del equipo | El cliente instala con un código de emparejamiento; el soporte fino se hace en remoto |
| Configuración de impresoras | En base de datos, no en la máquina |

## Alcance

**Dentro:**

1. Mesas con QR por local, y generación de los códigos desde el panel.
2. Carta pública del tenant en `/m/{token}`, con categorías, productos, alérgenos y extras.
3. Carrito en el navegador, con importes recalculados en servidor al cobrar.
4. Cobro con Stripe: PaymentIntent, y webhook idempotente como única vía de marcar pagado.
5. Numeración de pedidos por local y día, atómica.
6. Panel de comandas para el personal, en tiempo real, separado en cocina y barra.
7. Seguimiento del pedido para el comensal.
8. Restricción de `memberships.role`, pendiente del sub-proyecto 1.
9. App de escritorio Electron con papel de `agente`: emparejamiento por código, suscripción a pedidos, recuperación de no impresos, descubrimiento y configuración de impresoras, e impresión ESC/POS con enrutado por destino.

**Fuera** (sub-proyectos posteriores): canal kiosko y TPV Paytef (4), Stripe Connect y facturación (5), CRUD de productos en el panel de administración, devoluciones, edición de pedidos, propinas, y división de cuenta.

**Criterio de éxito:** en local, con dos tenants de prueba, un pedido pagado desde el navegador aparece en el panel del personal y se imprime en una impresora simulada; y el personal de un tenant no ve jamás un pedido del otro.

## Modelo de datos

Todas las tablas llevan `tenant_id uuid not null` con índice, y todas las claves únicas de negocio se componen con `tenant_id`. La suite anti-fuga las descubre automáticamente y exigirá políticas para cada una.

```
tables            id, tenant_id, venue_id, label, token uuid unique,
                  sort_order, is_active, created_at
                  UNIQUE (tenant_id, venue_id, label)

orders            id, tenant_id, venue_id, table_id,
                  order_number int, channel text,
                  status text CHECK (pending|paid|preparing|served|cancelled),
                  subtotal, tax_amount, total numeric(10,2), currency text,
                  stripe_payment_intent_id text UNIQUE, paid_at timestamptz,
                  kitchen_status, bar_status CHECK (pending|done|na),
                  printed_at timestamptz, printed_targets jsonb default '{}',
                  public_token uuid unique, created_at

order_items       id, tenant_id, order_id, product_id (ON DELETE SET NULL),
                  name_snapshot jsonb, unit_price numeric(10,2),
                  quantity int CHECK (quantity > 0), line_total numeric(10,2),
                  destination text CHECK (cocina|barra), notes text

order_item_extras id, tenant_id, order_item_id, extra_id (ON DELETE SET NULL),
                  name_snapshot jsonb, price numeric(10,2)

order_counters    tenant_id, venue_id, date, last_number
                  PRIMARY KEY (tenant_id, venue_id, date)

devices           id, tenant_id, venue_id, name, roles text[],
                  pairing_code text, pairing_expires_at, paired_at,
                  app_version, last_seen_at, os, created_at

printers          id, tenant_id, venue_id, device_id, name,
                  connection jsonb, destination CHECK (cocina|barra|todas),
                  is_default boolean, enabled boolean
```

Notas de diseño:

- `name_snapshot` y `unit_price` se copian en el momento de la compra. Subir el precio de un producto no debe alterar lo que dice un pedido de hace un mes. `product_id` se conserva para informes futuros, con `ON DELETE SET NULL` para que borrar un producto no destruya el histórico contable.
- `tables.token` es un uuid no adivinable. Con un simple número de mesa en la URL, cualquiera podría pedir a la mesa 7 desde su casa.
- `orders.public_token` permite al comensal consultar su propio pedido sin autenticarse y sin poder enumerar los ajenos.
- `printed_at` y `printed_targets` entran desde el primer día, aunque la impresión llegue en la última fase: la garantía de no perder un pedido cobrado es una propiedad de los datos, y sin esas columnas no se puede preguntar qué se pagó y no se imprimió.
- El enrutado a impresora usa `categories.destination`, que ya existe, propagado a `order_items.destination` en el momento de crear el pedido. Un mapeo por categoría concreta puede añadirse después sin migrar nada.
- `orders.channel` toma valores del mismo vocabulario que `tenant_settings.channels` (`qr-mesa`, `kiosko`), con una restricción que lo garantice. Este sub-proyecto solo produce `qr-mesa`.
- `printers.device_id` es nulable. Con valor, la impresora está atada a ese equipo, que es el caso de una impresora USB. Sin valor, cualquier dispositivo con papel de `agente` en ese local puede imprimir en ella, que es el caso de una impresora de red.
- `kitchen_status` y `bar_status` valen `na` cuando el pedido no tiene ninguna línea con ese destino. Se calculan al crear el pedido, no después, para que el panel no muestre una comanda de barra vacía esperando a que alguien la marque.

## Cobro

El pedido se crea **antes** de pagar, con `status = 'pending'`, para que el webhook pueda encontrarlo por `stripe_payment_intent_id`.

El servidor recalcula subtotal, impuesto (desde `tenant_settings.fiscal.taxRate`) y total leyendo los precios de la base de datos. Lo que envía el navegador se usa solo para saber **qué** se pide, nunca **cuánto** cuesta.

El webhook de Stripe es la única cosa que marca un pedido como pagado. Es idempotente por `stripe_payment_intent_id`: recibirlo dos veces deja el pedido igual. La pantalla de agradecimiento no marca nada, solo consulta — si lo hiciera, un cliente podría marcar su propio pedido como pagado sin pagar.

## Tiempo real: dos mecanismos distintos

El comensal es anónimo y, por decisión del sub-proyecto 1, nunca habla directamente con Supabase. Eso impide usar Realtime en su navegador, porque Realtime exige un cliente de Supabase con la anon key.

- **Comensal:** la pantalla de seguimiento consulta al servidor de Next cada pocos segundos, identificándose con su `public_token`. Sin anon key en el navegador, sin posibilidad de enumerar pedidos ajenos. Un pedido dura veinte minutos; sondear es suficiente.
- **Personal:** está autenticado y lleva el claim de tenant en su JWT, así que usa Supabase Realtime sobre el canal `tenant:{id}:orders` con RLS aplicándose de verdad.
- **Dispositivo:** igual que el personal, con su propia cuenta de servicio.

## Emparejamiento de dispositivos

El administrador da de alta un dispositivo en el panel y obtiene un código corto y caducable. La app de escritorio lo pide en su primera ejecución; el servidor lo valida y entrega al dispositivo **sus propias credenciales**, que se guardan en el directorio de datos del usuario.

Cada dispositivo recibe una cuenta de servicio con su `tenant_id`, de modo que RLS le aplica igual que a cualquier otro actor y Realtime le funciona de forma nativa.

Esto elimina por construcción un problema que arrastran los sistemas actuales: hoy el agente de impresión lleva la URL y la anon key escritas en su código fuente, y el instalador del kiosko incluye un `GH_TOKEN` dentro del `.exe`. En este modelo ningún secreto viaja en el instalable.

La configuración de impresoras vive en base de datos, no en la máquina, para que una IP mal puesta se pueda corregir en remoto sin pedirle nada al hostelero.

## No perder un pedido cobrado

Tres mecanismos, porque ninguno basta por sí solo:

1. **Realtime** para el caso normal, que es instantáneo.
2. **Recuperación al arrancar y al reconectar**: el dispositivo consulta pedidos `paid` cuyo `printed_targets` no cubra todas sus impresoras de destino. Si el local estuvo horas sin red, al volver imprime lo pendiente.
3. **Idempotencia por impresora**: `printed_targets` registra qué impresora imprimió qué y cuándo, así que un reintento nunca duplica un ticket.

## Autorización del personal

Una cuenta por local con `role = 'staff'` en `memberships`, con sesión larga pensada para una tablet fija en cocina.

Este es el primer sub-proyecto que crea usuarios autenticados reales, así que aquí se cierra la deuda anotada en el sub-proyecto 1: **`memberships.role` no está vigilado por ninguna política**, de modo que hoy un `staff` podría ascenderse a `owner` con un `update`. Las escrituras sobre `memberships` pasan a estar restringidas antes de que exista cualquier interfaz autenticada.

## Estrategia de pruebas

- **Anti-fuga**: automática. Las tablas nuevas son descubiertas por la suite existente, que exigirá políticas y cobertura de escritura para cada una.
- **Importes**: un carrito con precios manipulados se cobra al precio real de la base de datos.
- **Webhook**: aplicarlo dos veces deja el pedido idéntico. Un webhook con firma inválida se rechaza.
- **Numeración**: el contador es atómico bajo concurrencia.
- **Impresión sin hardware**: un servidor ESC/POS falso abre un socket TCP, acepta la conexión del driver y captura los bytes. Permite afirmar en CI que el ticket lleva las líneas correctas, que un artículo de barra no se imprime en cocina, y que un reintento no duplica.
- **E2E**: flujo completo con tarjeta de prueba en dos tenants, y la prueba que de verdad importa — el panel del tenant A no muestra jamás un pedido del tenant B, ni por Realtime ni al recargar.
- **Manual**: una lista corta contra hardware real. El papel, el corte y los acentos solo se validan mirándolos.

## Fases

El plan de implementación se organiza en tres fases, cada una con un entregable verificable:

| Fase | Entrega | Verificable |
|---|---|---|
| A | Mesas, carta, carrito, cobro | Pagas con tarjeta de prueba y el pedido queda registrado con sus líneas y su número |
| B | Panel de comandas, seguimiento, cierre de `memberships.role` | Pagas en un móvil y la comanda aparece sola en otra pantalla |
| C | App de escritorio, emparejamiento, impresión | Pagas y sale el papel |

## Manejo de errores

- Token de mesa desconocido o mesa desactivada: 404, sin revelar qué mesas existen.
- Producto no disponible o borrado entre añadir al carrito y pagar: el cobro se rechaza indicando qué línea falló, sin cobrar nada.
- Fallo al crear el PaymentIntent: el pedido queda `pending` y se limpia por caducidad; nunca se muestra como pagado.
- Webhook con firma inválida: 400 y no se toca el pedido.
- Impresora inalcanzable: se reintenta con espera creciente; el pedido permanece sin marcar en `printed_targets` para que la recuperación lo reintente.
- Dispositivo con código de emparejamiento caducado: mensaje claro y posibilidad de pedir uno nuevo desde el panel.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un pedido cobrado no se imprime y nadie se entera | Recuperación al reconectar más una consulta de pedidos pagados sin imprimir, visible en el panel |
| Impresión duplicada tras un reintento | Idempotencia por impresora en `printed_targets` |
| La red del local rompe supuestos que en local no se ven | Lista de comprobación manual contra hardware real antes de dar la fase C por buena |
| El sub-proyecto es grande y se pierde la señal de avance | Tres fases con entregable verificable cada una |

## Regla de despliegue

Como todo sub-proyecto, el entregable se demuestra **en local**, con tenants de prueba. Los repositorios `GARUM`, `web-manuela`, `kiosko-manuela` y `agente-impresora-v2` siguen dando servicio y no se tocan, ni ellos ni sus proyectos Supabase de producción. La migración de un negocio real es un paso posterior y separado, que decide el propietario del proyecto.
