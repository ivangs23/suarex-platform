# 0007 — Todo acceso a datos pasa por `tenantScoped` o por una exención nombrada y numerada

**Estado:** vigente · **Fecha:** 2026-10-23 (recogida de `packages/db/src/client.ts`)

## Contexto

El servidor de la web habla con Supabase con la **service role**, que se salta RLS. Con ella,
un `.eq("tenant_id", …)` olvidado en un repositorio no da error: devuelve los datos de OTRO
cliente. RLS protege los accesos con JWT (personal, dispositivo); este código necesita su propia
garantía, y tiene que ser estructural, no depender de acordarse.

## Decisión (`packages/db/src/client.ts`)

- **`serviceClient()` no se exporta.** Importarlo desde otro fichero es un error de compilación
  (TS2459), vigilado por `__compile_fixtures__` y `tests/integration/tenant-filter-structural.test.ts`.
  Solo `client.ts` toca Supabase sin filtro.
- **`tenantScoped(tabla, tenantId)`** es la vía para toda tabla con `tenant_id`:
  - `tenantId` es obligatorio: omitirlo no compila.
  - `select`, `update` y `delete` aplican el filtro ANTES de devolver el builder, así que quien llama solo añade condiciones.
  - `insert` y `upsert` sobrescriben `tenant_id` con el del parámetro.
  - `TenantScopedTable` se comprueba contra los tipos generados (`_TenantScopedTableExiste`).
- **Todo lo demás es una exención.** Cada exención:
  - tiene su propio accessor, estrecho por firma (una tabla, una RPC o un bucket fijos);
  - va nombrada y numerada en `client.ts`, con su argumento de seguridad en no más de 8 líneas;
  - figura en la tabla de abajo.
- **Nunca se reutiliza una exención para otro caso.** Una necesidad nueva lleva un número nuevo.

## Consecuencias

- La revisión de seguridad del acceso a datos se reduce a `client.ts` y a esta tabla: un llamante nuevo de una exención es motivo de revisión.
- Barren de verdad varios tenants solo:
  - la consola de plataforma (16ª);
  - el mantenimiento: salud de dispositivos (18ª), retención (21ª, 27ª), pedidos caducados (24ª) y la gracia vencida dentro de la 14ª.
- La Admin API de Auth tiene una exención por llamante (6ª, 10ª, 12ª, 17ª), para que cada punto que crea o borra cuentas sea rastreable.
- Las exenciones 22ª-27ª se numeraron el 2026-10-23. Antes, la del tótem no tenía número y cinco RPC decían "misma exención que…".

## Registro

| Nº | Accessor | Qué permite y por qué no es `tenantScoped` | Llamantes |
|---|---|---|---|
| 1ª | `tenantsTableForHostResolution` | Leer UNA fila de `tenants` por clave única (`slug`, `custom_domain`, `id`). `tenants` no tiene `tenant_id`; el host o el slug es lo que revela el tenant | `tenants.ts`: `findTenantByHost`, `findTenantBySlug`, `isActiveCustomDomain`, `getTenantCustomDomain`, `getTenantStripeAccount`, `getTenantBillingState` |
| 2ª | `tablesTableForTokenResolution` | Mesa por su token de QR, que revela el tenant | `tables.ts`: `findTableByToken` |
| 3ª | `ordersTableForPaymentResolution` | Pedido por `stripe_payment_intent_id` o `public_token` (únicos): Stripe y el invitado no conocen el tenant | `orders.ts`: `markOrderPaid`, `markOrderDisputed`, `getOrderByPublicToken`, `getOrderReceipt`, `getOrderLocale` |
| 4ª | `nextOrderNumberRpc` | RPC `SECURITY DEFINER` con el tenant como parámetro | `orders.ts`: `createPendingOrder` |
| 5ª | `devicesTableForPairing` | Dispositivo por `pairing_code` (revela el tenant), canje atómico y enlace de `auth_user_id` por `id` | `devices.ts`: `pairDevice` |
| 6ª | `authAdminForDevicePairing` | Admin API de Auth: la cuenta de servicio del dispositivo | `devices.ts`: `pairDevice` (vía `findAuthUserIdByEmail`, `ensureDeviceAuthAccount`) |
| 7ª | `reservePrintedRpc` | RPC `SECURITY DEFINER` con el tenant como parámetro | `print-jobs.ts`: `reservePrinted` |
| 8ª | `catalogBucket` | Storage atado al bucket `catalog`; solo el service role escribe | `storage.ts`: `uploadProductImage`, `removeProductImage`, `uploadBrandingImage` |
| 9ª | `globalAllergensTable` | Los 14 alérgenos de la UE (`tenant_id` NULL), filtro fijo dentro | `admin-catalog.ts`: `listAssignableAllergens` |
| 10ª | `authAdminForStaffCreation` | Admin API de Auth: alta y listado de personal | `admin-staff.ts`: `createStaff`, `listStaff` |
| 11ª | `pairRateLimitRpc` | RPC de límite por IP del emparejamiento; no depende de tenant | `pair-rate-limit.ts`: `checkPairRateLimit` |
| 12ª | `authAdminForDeviceReset` | Admin API de Auth: borrar la cuenta de un dispositivo dado de baja | `admin-devices.ts`: `resetDevice` |
| 13ª | `tenantsTableForCustomDomainWrite` | Escribir `custom_domain` del PROPIO tenant (`.eq("id", <sesión>)`, valor normalizado) | `tenants.ts`: `setTenantCustomDomain` |
| 14ª | `tenantsTableForBilling` | Escribir el estado de suscripción por `stripe_customer_id`; barrido de gracia vencida | `billing.ts`: `applySubscriptionState`, `suspendExpiredGrace` |
| 15ª | `platformAdminsTable` | `platform_admins` por PK; un superadmin no es de ningún cliente | `platform.ts`: `isPlatformAdmin` |
| 16ª | `tenantsTableForPlatformConsole` | `tenants` SIN filtro (listar, crear): la consola de plataforma | `platform.ts`: `listPlatformTenants`, `createTenantWithOwner`, `setTenantStatus`, `getTenantStripeCustomer`, `setTenantStripeCustomer` |
| 17ª | `authAdminForPlatformConsole` | Admin API de Auth: invitar al primer owner | `platform.ts`: `createTenantWithOwner` (vía `buscarUsuarioPorEmail`) |
| 18ª | `sweepDeviceHealthRpc` | RPC que barre `devices` de todos: mantenimiento | `device-health.ts`: `sweepDeviceHealth` |
| 19ª | `registrarEscaneoRpc` | RPC de incremento atómico; deduce el tenant de la mesa | `analytics.ts`: `registrarEscaneo` |
| 20ª | `stripeEventsTableForWebhook` | `stripe_events` por id de evento; su `tenant_id` puede ser nulo | `stripe-events.ts`: `stripeEventYaProcesado`, `recordStripeEvent` |
| 21ª | `stripeEventsTableForRetention` | Borrar eventos de más de 90 días de todos: retención | `stripe-events.ts`: `purgeStripeEvents` |
| 22ª | `devicesTableForTotemToken` | Dispositivo por `totem_token`, que revela el tenant | `kiosko-entry.ts`: `findDeviceByTotemToken` |
| 23ª | `rateLimitRpc` | RPC de límite genérico; no depende de tenant | `rate-limit.ts`: `checkRateLimit` |
| 24ª | `expirePendingOrdersRpc` | RPC de mantenimiento: pedidos pendientes caducados | `orders.ts`: `expirePendingOrders` |
| 25ª | `marcarAgotadoHoyRpc` | RPC con el tenant como parámetro; hora de vuelta en la zona del local | `admin-catalog.ts`: `marcarAgotadoHoy` |
| 26ª | `recordOrderRefundRpc` | RPC por `stripe_payment_intent_id`, atómica frente a eventos solapados | `orders.ts`: `markOrderRefunded` |
| 27ª | `purgeOrderPersonalDataRpc` | RPC de retención: barre todos los tenants por igual | `orders.ts`: `purgeOrderPersonalData` |
