# Sub-proyecto: Panel de administración

Fecha: 2026-07-22
Estado: aprobado, pendiente de plan de implementación de la fase D1

## Contexto

La plataforma ya sirve el canal QR completo: un comensal escanea, pide, paga, la comanda aparece en cocina y se imprime. Pero todo lo que un hostelero necesita configurar —su carta, sus mesas, sus impresoras, su marca— hoy solo se puede cambiar insertando filas SQL a mano. Sin un panel de administración, la plataforma no es utilizable por un cliente real.

Este sub-proyecto construye ese panel. Además cierra el riesgo de fundación número uno, registrado desde el sub-proyecto 1: **la RLS no tiene dimensión de rol**. Hoy `staff`, `admin` y `owner` son idénticos en la capa de datos — un camarero puede escribir lo mismo que el dueño. La primera RLS por rol ya existe (el rol `device` quedó acotado a solo leer e imprimir, con la función `public.current_tenant_role()` y el patrón de separar policies de lectura y escritura). Este sub-proyecto generaliza ese patrón a los roles humanos.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Alcance | Catálogo, mesas y QRs, dispositivos e impresoras, ajustes del negocio |
| Modelo de roles | `owner` y `admin` gestionan todo; `staff` solo opera (ver comandas, marcar servido) |
| Altas que tocan `memberships` | Server Actions con service role, tras comprobar el rol del solicitante por el claim del JWT |
| UI | Funcional primero; el diseño visual es un paso posterior |
| Imágenes de producto | Supabase Storage, bucket por tenant, subida por servidor con validación de rol |
| `staff` tras la restricción | Conserva exactamente lo que hace hoy en el panel de comandas; pierde todo lo demás |

## Modelo de roles

Tres roles humanos, más el `device` ya acotado:

- **`owner`**: el dueño. Puede todo dentro de su tenant: catálogo, mesas, dispositivos, ajustes, y alta de personal.
- **`admin`**: un encargado. En este sub-proyecto tiene los mismos permisos de gestión que `owner`. La distinción fina (facturación, gestión de otros admins) se reserva para cuando exista billing; separarlos ahora sin esas features sería adivinar.
- **`staff`**: el camarero. Solo lo que ya hace: ver el panel de comandas y marcar servido. No toca ninguna configuración.
- **`device`**: ya acotado. Solo lee lo que imprime y marca impreso.

Que `owner` y `admin` compartan permisos hoy no significa fundir los roles: siguen siendo valores distintos en `memberships.role`, y las policies los nombran a ambos explícitamente, de modo que separarlos después es añadir una condición, no migrar datos.

## Cómo cambia la RLS

Hoy cada tabla tiene una policy `for all to authenticated using (tenant_id = current_tenant_id())`. Se generaliza el patrón ya usado con `device`:

- **Tablas de configuración** (`categories`, `products`, `product_extras`, `allergens`, `tables`, `devices`, `printers`, `tenant_settings`, `venues`): lectura para todo el tenant; **escritura solo para `owner`/`admin`**. Un `staff` autenticado ya no puede modificarlas.
- **Tablas de operación** (`orders`, `order_items`, `order_item_extras`): sin cambios. `staff` sigue leyendo pedidos y actualizando `kitchen_status`/`bar_status`, que es su trabajo en el panel de comandas de la fase B.
- **`memberships`**: sigue sin escritura directa desde `authenticated` (bloqueado desde la fase B). Las altas de personal las hace el servidor con service role.

Las policies de escritura por rol tendrán la forma `using (tenant_id = current_tenant_id() and current_tenant_role() in ('owner', 'admin'))`. Cada forma canónica nueva se añade **textual y exacta** al allowlist de `tests/integration/helpers/policy-check.ts`; nunca se relaja la comparación. La suite anti-fuga, que ya cubre estas tablas, seguirá exigiendo que ninguna quede sin policy y que ninguna sea `USING (true)`.

Caso especial de `allergens`: contiene los 14 alérgenos globales de la UE con `tenant_id NULL`, ya intocables por cualquier tenant (solo el service role los escribe). Al añadir el rol a su policy de escritura, esa propiedad debe conservarse: un `owner` puede gestionar los alérgenos propios de su tenant, pero ni él ni nadie autenticado puede modificar los globales. La forma de escritura se compone sobre el `tenant_id = current_tenant_id()` existente, que ya excluye los `NULL`, así que los globales siguen a salvo — pero el plan debe verificarlo con un test explícito, no darlo por hecho.

## Autorización de las Server Actions

Todo lo que escribe pasa por una Server Action que, antes de tocar nada:

1. Resuelve la sesión con `resolveStaffSession(hostTenant)` — que ya exige que el tenant del claim coincida con el resuelto por Host, y falla cerrado.
2. Comprueba que el `tenant_role` del claim es `owner` o `admin`. Un `staff` que llame a la acción directamente es rechazado.
3. Solo entonces ejecuta la escritura, acotada al tenant de la sesión — nunca a un `tenantId` que venga del cliente.

La defensa es doble: la RLS impide la escritura aunque la Server Action tuviera un fallo, y la Server Action rechaza antes de llegar a la base. Ninguna de las dos confía en la otra.

Las altas de personal y la generación de códigos de emparejamiento usan el service role (que salta RLS), así que ahí la comprobación de rol en la Server Action es el único control — y por eso es obligatoria y se prueba explícitamente.

## Descomposición en fases

El alcance es grande; se entrega en tres fases, cada una verificable.

| Fase | Entrega | Criterio de éxito |
|---|---|---|
| **D1** | RLS por rol + layout del panel con guard + CRUD de catálogo (categorías, productos, extras, alérgenos) con subida de imágenes | Un `owner` da de alta y edita la carta desde el panel; un `staff` no puede, ni por la interfaz ni llamando a la acción directamente; el panel de comandas de `staff` sigue funcionando |
| **D2** | Mesas y generación de QRs; dispositivos con código de emparejamiento real; configuración de impresoras | Un `owner` crea una mesa y obtiene su QR; da de alta un dispositivo y obtiene un código que empareja de verdad; configura una impresora con IP y destino |
| **D3** | Ajustes del negocio (marca, datos fiscales, IVA); alta de personal | Un `owner` cambia el nombre y los colores del negocio y se reflejan en la carta; da de alta a un camarero que puede entrar al panel de comandas |

Cada fase tendrá su propio plan. Este documento diseña la D1 en detalle; D2 y D3 se detallarán cuando la anterior esté cerrada.

## Diseño de la fase D1

### Alcance

Dentro: la migración de RLS por rol para todas las tablas de configuración; la función helper de rol (ya existe, se reutiliza); las Server Actions de catálogo con comprobación de rol; el layout del panel de admin con guard que rechaza a quien no sea `owner`/`admin`; las pantallas funcionales de categorías, productos, extras y alérgenos; y la subida de imágenes a Storage.

Fuera (fases D2/D3): mesas, QRs, dispositivos, impresoras, ajustes del negocio, alta de personal.

Éxito: un `owner` gestiona su carta entera desde el panel; un `staff` es rechazado en cada intento de gestión (interfaz y acción directa); la suite anti-fuga y el panel de comandas siguen en verde.

### Estructura

```
supabase/migrations/
  20260722000006_role_write_policies.sql   RLS por rol en las tablas de configuración
packages/db/src/
  admin-catalog.ts                          repositorios de escritura de catálogo (service role)
apps/web/
  lib/require-manager.ts                    guard: sesión + rol owner|admin, o rechaza
  app/admin/layout.tsx                      layout con el guard
  app/admin/login/…                         acceso (reutiliza el flujo de staff)
  app/admin/catalogo/…                      categorías, productos, extras, alérgenos
  app/admin/catalogo/actions.ts             Server Actions de catálogo
  lib/storage.ts                            subida a Storage con validación
tests/
  integration/role-write-policies.test.ts   RLS: staff no escribe config, owner sí
  integration/admin-catalog.test.ts         las acciones respetan rol y tenant
  e2e/admin-catalogo.spec.ts                flujo de un owner gestionando la carta
```

### Manejo de errores

- Un `staff` que abre `/admin`: redirigido al panel de comandas o a un aviso de permisos, sin filtrar qué existe.
- Un `staff` que llama a una Server Action de gestión directamente: rechazada con un error claro, sin efecto.
- Una imagen de tipo o tamaño no permitido: rechazada antes de subir, con mensaje.
- Borrar una categoría con productos: recordar al usuario que el borrado en cascada se lleva los productos (deuda registrada desde la fundación) — la interfaz avisa antes de confirmar.
- Un fallo de Storage tras crear el producto: el producto queda sin imagen, nunca a medias; se puede reintentar la subida.

### Pruebas

- **RLS por rol**: un `staff` autenticado no puede `INSERT`/`UPDATE`/`DELETE` en ninguna tabla de configuración; un `owner` sí. Con control positivo (el `owner` de verdad puede) y regresión (el `staff` sigue pudiendo operar en `orders`).
- **Server Actions**: una acción de gestión llamada con sesión `staff` es rechazada; con `owner` funciona; nunca escribe en un tenant que no sea el de la sesión.
- **Anti-fuga**: automática; las formas de policy nuevas entran exactas en el allowlist.
- **E2E**: un `owner` inicia sesión, crea una categoría, un producto con imagen, y lo ve en la carta pública; un `staff` que inicia sesión no ve el panel de gestión.

### Riesgos

| Riesgo | Mitigación |
|---|---|
| Acotar `staff` rompe el panel de comandas de la fase B | Las tablas de operación (`orders`, líneas) no se tocan; test de regresión explícito |
| Una Server Action con service role sin comprobar rol es un agujero | Comprobación de rol obligatoria y probada en cada acción; la RLS es la segunda barrera |
| La subida de imágenes expone Storage al navegador | La subida pasa por el servidor con validación de rol y tenant; el navegador no habla con Storage |
| Una forma de policy nueva demasiado permisiva pasa el allowlist | El allowlist es de coincidencia exacta; una forma degradada no coincide y rompe el build |

## Regla de despliegue

Como todo el proyecto, la D1 se demuestra en local con tenants de prueba. Los repositorios y proyectos Supabase en producción no se tocan.
