import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

let cached: SupabaseClient<Database> | null = null;

/**
 * Cliente con service role, SIN filtro de tenant. No se exporta (importarlo desde otro fichero es
 * TS2459): solo este fichero toca Supabase sin `tenantScoped`. Ver
 * docs/decisions/0007-tenantscoped-y-sus-exenciones.md.
 */
function serviceClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias");
  }

  cached = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

/**
 * Tablas de `public` con columna `tenant_id` (ver `supabase/migrations/*.sql`). `tenants`
 * NO está aquí a propósito: se aísla por su propia `id`, no por `tenant_id` -- ver
 * `tenantsTableForHostResolution` más abajo para su caso.
 */
export type TenantScopedTable =
  | "venues"
  | "tenant_settings"
  | "memberships"
  | "allergens"
  | "categories"
  | "products"
  | "product_extras"
  | "product_option_groups"
  | "tables"
  | "orders"
  | "order_items"
  | "order_item_extras"
  | "printers"
  // Contador agregado de escaneos del QR (`20260924000003_analitica_carta.sql`). Lleva
  // `tenant_id` y se LEE como cualquier otra tabla del tenant; lo que no pasa por aquí es la
  // escritura, que va por `registrarEscaneoRpc` para que dos escaneos simultáneos no se pisen.
  | "menu_scans"
  // Sub-proyecto 4 (modo totem): config de pago del tenant. `tenant_id` es su PK, encaja en la
  // unión. La lectura del secreto por el device NO pasa por aquí (RPC acotada); esto es solo
  // para que owner/admin la gestionen desde el panel (misma vía service-role acotada por tenant).
  | "tenant_payment_config"
  // Credenciales de Stripe por cliente (canal QR): mismo patrón acotado por tenant.
  | "tenant_stripe_config"
  // Task 3 (D2, generación del código de emparejamiento, `src/admin-devices.ts`):
  // `devices` tiene `tenant_id` igual que el resto de esta unión y encaja sin más.
  // NO sustituye a `devicesTableForPairing` (quinta exención más abajo): esa sigue
  // siendo la única vía para el canje por `pairing_code` -- una búsqueda que, por
  // definición, ocurre ANTES de que el llamante conozca el tenant, así que no puede
  // pasar por `tenantScoped`. `tenantScoped("devices", tenantId)` es para el lado
  // contrario: crear/listar/borrar dispositivos cuando el tenant YA se conoce
  // (sesión de owner/admin en el panel).
  | "devices";

type Tablas = Database["public"]["Tables"];
/** Lo que se escribe en una tabla del tenant, sin `tenant_id`: lo pone `tenantScoped`. */
type SinTenant<Fila> = Omit<Fila, "tenant_id">;

// Cada nombre de la unión tiene que existir en los tipos generados: renombrar o borrar una
// tabla en una migración sin tocar esta lista no compila.
type Cierto<T extends true> = T;
export type _TenantScopedTableExiste = Cierto<
  TenantScopedTable extends keyof Tablas ? true : false
>;

/**
 * ÚNICO punto de entrada a una tabla del tenant. `tenantId` es obligatorio (omitirlo no compila)
 * y el filtro se aplica ANTES de devolver el builder: quien llama solo añade condiciones, nunca
 * lo quita. Todo lo demás es una exención numerada de abajo, registrada en
 * docs/decisions/0007-tenantscoped-y-sus-exenciones.md.
 */
export function tenantScoped<T extends TenantScopedTable>(table: T, tenantId: string) {
  // El filtro va por `match` y no por `eq`: sobre un genérico, TypeScript no puede comprobar
  // que `tenant_id` sea columna de `Tablas[T]` (lo es en todas, por construcción de la lista).
  // `match` genera el mismo `tenant_id=eq.<id>` y devuelve el builder con su tipo intacto.
  const delTenant = { tenant_id: tenantId };
  return {
    // Genérico sobre `Query`, igual que el `.select()` nativo de postgrest-js: si
    // `columns` se tipara como `string` a secas (en vez de preservar el literal que
    // recibe cada llamada), postgrest-js no puede parsear qué columnas se pidieron y el
    // resultado se degrada a `GenericStringError` en vez de la forma real de la fila.
    select<Query extends string = "*">(columns: Query) {
      return serviceClient().from(table).select(columns).match(delTenant);
    },

    /**
     * `tenant_id` se sobreescribe DESPUÉS de esparcir la fila, así que un
     * `tenant_id` ajeno que venga en los datos no puede colarse: el del
     * parámetro siempre gana.
     */
    insert(rows: SinTenant<Tablas[T]["Insert"]> | SinTenant<Tablas[T]["Insert"]>[]) {
      const list = Array.isArray(rows) ? rows : [rows];
      const scoped = list.map((row) => ({ ...row, tenant_id: tenantId }));
      // `as never`: el tipo real ya lo comprueba la firma en cada llamada; aquí, sobre el
      // genérico, postgrest-js no puede resolver el `Insert` de la tabla.
      return serviceClient()
        .from(table)
        .insert(scoped as never);
    },

    /**
     * `tenant_id` se elimina de los valores (no tiene sentido reasignar una fila
     * a otro tenant) y el filtro se aplica antes de devolver el builder.
     */
    update(values: SinTenant<Tablas[T]["Update"]>) {
      const { tenant_id: _ignored, ...rest } = values as Record<string, unknown>;
      // `as never`: mismo motivo que en `insert`.
      return serviceClient()
        .from(table)
        .update(rest as never)
        .match(delTenant);
    },

    /**
     * Como `insert`, pero UPSERT sobre `onConflict` (columnas separadas por coma): un reintento
     * de `pairDevice` tras un fallo parcial vuelve a escribir la membership sin chocar con la PK.
     */
    upsert(row: SinTenant<Tablas[T]["Insert"]>, onConflict: string) {
      const { tenant_id: _ignored, ...rest } = row as Record<string, unknown>;
      const scoped = { ...rest, tenant_id: tenantId };
      // `as never`: mismo motivo que en `insert`.
      return serviceClient()
        .from(table)
        .upsert(scoped as never, { onConflict });
    },

    /**
     * El filtro de tenant va antes de devolver el builder, como en `select`/`update`: no se
     * puede borrar una fila de otro tenant pasando su id.
     */
    delete() {
      return serviceClient().from(table).delete().match(delTenant);
    },
  };
}

/**
 * PRIMERA EXENCIÓN DELIBERADA. Lectura de UNA fila de `tenants` por clave única (`slug`,
 * `custom_domain` o `id`), nunca un barrido. `tenants` no tiene `tenant_id`, y resolver el host o
 * el slug es justo lo que revela el tenant. Solo lectura: cada escritura a `tenants` tiene su
 * propia exención (13ª, 14ª, 16ª). Llamantes en `src/tenants.ts`.
 */
export function tenantsTableForHostResolution() {
  return serviceClient().from("tenants");
}

/**
 * DECIMOTERCERA EXENCIÓN DELIBERADA. Escritura del `custom_domain` del PROPIO tenant: su único
 * llamante, `setTenantCustomDomain`, filtra siempre `.eq("id", tenantId)` con el de la sesión, y
 * el valor llega normalizado (`normalizeCustomDomain`) desde la Server Action: decide qué
 * certificados pide Caddy y qué tenant sirve un Host. Separada de la 1ª para que esa siga siendo
 * de solo lectura.
 */
export function tenantsTableForCustomDomainWrite() {
  return serviceClient().from("tenants");
}

/**
 * DECIMOCTAVA EXENCIÓN DELIBERADA. `sweep_device_health` (SECURITY DEFINER) recorre `devices` de
 * TODOS los tenants: encontrar los PCs caídos allá donde estén es mantenimiento de la plataforma.
 * El UPDATE ... RETURNING es atómico, así que dos crons solapados no avisan dos veces del mismo.
 * Solo `sweepDeviceHealth` (`src/device-health.ts`).
 */
export function sweepDeviceHealthRpc(minutos: number) {
  return serviceClient().rpc("sweep_device_health", { p_minutos: minutos });
}

/**
 * DECIMOSEXTA EXENCIÓN DELIBERADA. `tenants` SIN ningún filtro, para listar todos y crear uno: es
 * la consola de plataforma, que por definición mira por encima de todos los clientes. No la acota
 * la firma sino su único llamante, `src/platform.ts`, usado solo desde `app/plataforma/**` detrás
 * de dos barreras (el 404 del proxy fuera del host de plataforma y `requirePlatformAdmin()`).
 * Un llamante nuevo es un fallo de revisión: otra necesidad, otra exención.
 */
export function tenantsTableForPlatformConsole() {
  return serviceClient().from("tenants");
}

/**
 * DECIMOSÉPTIMA EXENCIÓN DELIBERADA, mismo razonamiento que `authAdminForStaffCreation`: el
 * alta de un cliente crea la cuenta de Auth de su PRIMER owner -- el huevo y la gallina que el
 * panel no puede resolver, porque para crear personal ya hace falta un owner. No hay tabla que
 * filtrar (es la Admin API de Auth). Acotado por firma a `createTenantWithOwner`
 * (`src/platform.ts`); no se reutiliza la de staff para que cada punto que crea cuentas sea
 * rastreable a un único llamante.
 */
export function authAdminForPlatformConsole() {
  return serviceClient().auth.admin;
}

/**
 * DECIMOQUINTA EXENCIÓN DELIBERADA. `platform_admins` no tiene ni puede tener `tenant_id`: un
 * superadmin no es de ningún cliente. Búsqueda por PK desde `isPlatformAdmin` (`src/platform.ts`).
 * La tabla tiene RLS sin policies y revoke a anon/authenticated: este es el único camino hacia ella.
 */
export function platformAdminsTable() {
  return serviceClient().from("platform_admins");
}

/**
 * DECIMOCUARTA EXENCIÓN DELIBERADA. Escritura del estado de suscripción (`plan_status`, `status`,
 * `grace_until`, `stripe_subscription_id`) desde `src/billing.ts`. `applySubscriptionState`
 * localiza por `stripe_customer_id` (índice único parcial) porque el webhook de Stripe no conoce
 * tenants: una fila. `suspendExpiredGrace` barre por fecha a propósito: es mantenimiento.
 */
export function tenantsTableForBilling() {
  return serviceClient().from("tenants");
}

/**
 * SEGUNDA EXENCIÓN DELIBERADA, con el mismo razonamiento que
 * `tenantsTableForHostResolution`: el token del QR es lo que determina a qué tenant
 * pertenece la mesa, así que la búsqueda no puede filtrarse por un tenant que aún no
 * se conoce. Acotado por firma a `tables`; no es un escape hatch reutilizable.
 */
export function tablesTableForTokenResolution() {
  return serviceClient().from("tables");
}

/**
 * TERCERA EXENCIÓN DELIBERADA. `orders` por una columna con índice único global, una fila o
 * ninguna: `stripe_payment_intent_id` (el webhook de Stripe no conoce tenants) o `public_token`
 * (la pantalla del pedido, sin sesión: el token es lo que identifica la fila). Acotado por firma
 * a `orders`; llamantes en `src/orders.ts`.
 */
export function ordersTableForPaymentResolution() {
  return serviceClient().from("orders");
}

/**
 * CUARTA EXENCIÓN DELIBERADA. `next_order_number` es SECURITY DEFINER y recibe el
 * tenant como parámetro, así que el filtro va dentro de la propia función SQL.
 * Acotado por firma a esa única RPC.
 */
export function nextOrderNumberRpc(tenantId: string, venueId: string) {
  return serviceClient().rpc("next_order_number", {
    p_tenant_id: tenantId,
    p_venue_id: venueId,
  });
}

/**
 * DECIMONOVENA EXENCIÓN DELIBERADA. `registrar_escaneo` (SECURITY DEFINER) deduce el tenant y la
 * sede de la propia mesa, que es lo único que conoce la ruta del QR. RPC y no upsert porque el
 * incremento tiene que ser atómico: dos escaneos en el mismo segundo se pisarían.
 */
export function registrarEscaneoRpc(tableId: string) {
  return serviceClient().rpc("registrar_escaneo", { p_table_id: tableId });
}

/**
 * VIGÉSIMA EXENCIÓN DELIBERADA. `stripe_events` es un registro técnico de la plataforma: su
 * `tenant_id` es nulo cuando el webhook (el del entorno) no sabe de quién es el evento, así que
 * no encaja en `tenantScoped`. Acotado por firma a esa tabla y a `stripe-events.ts`
 * (`stripeEventYaProcesado`, `recordStripeEvent`): búsqueda e inserción por `id` del evento,
 * una fila o ninguna, nunca un barrido.
 */
export function stripeEventsTableForWebhook() {
  return serviceClient().from("stripe_events");
}

/**
 * VIGESIMOPRIMERA EXENCIÓN DELIBERADA, hermana de la anterior y separada de ella porque esta SÍ
 * barre: borra los eventos de más de 90 días de todos los negocios. Es retención, mantenimiento
 * de la plataforma, misma naturaleza que `purgeOrderPersonalDataRpc`. Acotado por firma a
 * `purgeStripeEvents` (`src/stripe-events.ts`), que lo llama el cron de `purge-orders`.
 */
export function stripeEventsTableForRetention() {
  return serviceClient().from("stripe_events");
}

/**
 * QUINTA EXENCIÓN DELIBERADA. `devices` por `pairing_code` (índice único parcial): el código es
 * lo que revela el tenant. También el canje atómico (un UPDATE ... RETURNING que borra el código y
 * fija `paired_at` sin SELECT previo; ver `pairDevice`) y el UPDATE que enlaza `auth_user_id` por
 * `id`. Siempre una fila conocida, nunca un barrido.
 */
export function devicesTableForPairing() {
  return serviceClient().from("devices");
}

/**
 * VIGESIMOSEGUNDA EXENCIÓN DELIBERADA. `devices` por `totem_token`, igual que la mesa por su
 * token: es la autoridad del canal kiosko y revela el tenant. Una fila, nunca un barrido. Solo
 * `findDeviceByTotemToken` (`src/kiosko-entry.ts`).
 */
export function devicesTableForTotemToken() {
  return serviceClient().from("devices");
}

/**
 * SEXTA EXENCIÓN DELIBERADA. El emparejamiento de un dispositivo crea su propia cuenta de
 * Supabase Auth (la cuenta de servicio no humana del tenant) antes de que exista ningún
 * `tenantId` conocido para filtrar nada -- no hay tabla que filtrar aquí, es la API de
 * administración de Auth, así que no encaja en `tenantScoped` ni necesita una. Acotado por
 * firma al único uso legítimo: `pairDevice` (`src/devices.ts`) llamando a
 * `createUser` para dar de alta la cuenta de servicio del dispositivo recién emparejado.
 */
export function authAdminForDevicePairing() {
  return serviceClient().auth.admin;
}

/**
 * SÉPTIMA EXENCIÓN DELIBERADA, mismo razonamiento que `nextOrderNumberRpc`:
 * `reserve_printed` es SECURITY DEFINER y recibe el tenant como parámetro, así que el
 * filtro (y la comprobación de qué impresoras de destino cubren el pedido) va dentro de
 * la propia función SQL, no aquí -- ver
 * `supabase/migrations/20260722000003_print_reservation.sql` para el razonamiento de
 * concurrencia. Acotado por firma a esa única RPC.
 */
export function reservePrintedRpc(
  tenantId: string,
  orderId: string,
  printerId: string,
  at: string,
) {
  return serviceClient().rpc("reserve_printed", {
    p_tenant_id: tenantId,
    p_order_id: orderId,
    p_printer_id: printerId,
    p_at: at,
  });
}

/**
 * OCTAVA EXENCIÓN DELIBERADA. Storage atado al bucket `catalog`, no `.storage` a secas: quien la
 * usa no puede pedir otro bucket ni una tabla. El bucket es público en lectura y sin policies de
 * escritura: solo el service role escribe, y solo por aquí (`src/storage.ts`, fotos de producto y
 * de marca).
 */
export function catalogBucket() {
  return serviceClient().storage.from("catalog");
}

/**
 * NOVENA EXENCIÓN DELIBERADA. Los 14 alérgenos globales de la UE (`tenant_id` NULL) no son de
 * ningún tenant. El filtro `is null` va DENTRO: quien llama solo puede pedir los globales, nunca
 * los de otro tenant (para los propios, `tenantScoped("allergens", …)`). Solo
 * `listAssignableAllergens` (`src/admin-catalog.ts`).
 */
export function globalAllergensTable() {
  return serviceClient().from("allergens").select("id, name_i18n, icon").is("tenant_id", null);
}

/**
 * DÉCIMA EXENCIÓN DELIBERADA. Admin API de Auth para el alta de personal: crea el usuario del
 * camarero antes de darle su membership; no hay tabla que filtrar. Solo `createStaff`/`listStaff`
 * (`src/admin-staff.ts`); cada punto que crea cuentas tiene su propia exención.
 */
export function authAdminForStaffCreation() {
  return serviceClient().auth.admin;
}

/**
 * UNDÉCIMA EXENCIÓN DELIBERADA. `check_pair_rate_limit` es SECURITY DEFINER y no depende de
 * ningún tenant (limita por IP el endpoint público de emparejamiento); se concede solo a
 * `service_role`. Acotado por firma a `checkPairRateLimit` (`src/pair-rate-limit.ts`).
 */
export function pairRateLimitRpc(ip: string, windowSeconds: number, max: number) {
  return serviceClient().rpc("check_pair_rate_limit", {
    p_ip: ip,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
}

/**
 * VIGESIMOTERCERA EXENCIÓN DELIBERADA. `check_rate_limit` (tabla genérica `rate_limit_hits`) es
 * SECURITY DEFINER, no depende de ningún tenant y se concede solo a `service_role`. Solo
 * `checkRateLimit` (`src/rate-limit.ts`).
 */
export function rateLimitRpc(bucket: string, key: string, windowSeconds: number, max: number) {
  return serviceClient().rpc("check_rate_limit", {
    p_bucket: bucket,
    p_key: key,
    p_window_seconds: windowSeconds,
    p_max: max,
  });
}

/**
 * VIGESIMOCUARTA EXENCIÓN DELIBERADA. `expire_pending_orders` es SECURITY DEFINER y mantenimiento
 * de la plataforma, no negocio de ningún cliente; solo para `service_role`. Solo
 * `expirePendingOrders` (`src/orders.ts`), desde el cron.
 */
export function expirePendingOrdersRpc(timeoutMinutes: number) {
  return serviceClient().rpc("expire_pending_orders", { p_timeout_minutes: timeoutMinutes });
}

/**
 * VIGESIMOQUINTA EXENCIÓN DELIBERADA. `marcar_agotado_hoy` es SECURITY DEFINER y recibe el tenant:
 * el filtro va en SQL, que además calcula la hora de vuelta en la ZONA DEL LOCAL. Solo
 * `marcarAgotadoHoy` (`src/admin-catalog.ts`).
 */
export function marcarAgotadoHoyRpc(tenantId: string, productId: string) {
  return serviceClient().rpc("marcar_agotado_hoy", {
    p_tenant_id: tenantId,
    p_product_id: productId,
  });
}

/**
 * VIGESIMOSEXTA EXENCIÓN DELIBERADA. `record_order_refund` es SECURITY DEFINER y localiza el
 * pedido por `stripe_payment_intent_id` (el webhook no conoce el tenant). El bloqueo de fila y el
 * total o parcial van dentro de la función: atómico frente a dos eventos solapados de Stripe.
 * Solo `markOrderRefunded` (`src/orders.ts`).
 */
export function recordOrderRefundRpc(paymentIntentId: string, refundedCents: number) {
  return serviceClient().rpc("record_order_refund", {
    p_payment_intent_id: paymentIntentId,
    p_refunded_cents: refundedCents,
  });
}

/**
 * VIGESIMOSÉPTIMA EXENCIÓN DELIBERADA. `purge_order_personal_data` es SECURITY DEFINER y
 * RETENCIÓN: barre todos los tenants por igual, que es lo que la retención exige; solo para
 * `service_role`. Solo `purgeOrderPersonalData` (`src/orders.ts`), desde el cron.
 */
export function purgeOrderPersonalDataRpc(notesDays: number, ordersMonths: number) {
  return serviceClient().rpc("purge_order_personal_data", {
    p_notes_days: notesDays,
    p_orders_months: ordersMonths,
  });
}

/**
 * DUODÉCIMA EXENCIÓN DELIBERADA, mismo razonamiento que `authAdminForDevicePairing` pero
 * para el reset: `resetDevice` (`src/admin-devices.ts`) borra la cuenta de Auth del
 * dispositivo (`deleteUser`) para revocar sus refresh tokens y su membership al dar de baja
 * o sustituir el PC. Acotado por firma a ese único uso; no se reutiliza el de pairing para
 * que cada punto que borra cuentas de Auth sea rastreable a un caller.
 */
export function authAdminForDeviceReset() {
  return serviceClient().auth.admin;
}
