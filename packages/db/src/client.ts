import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Cliente con service role, SIN NINGÚN filtro de tenant aplicado. Deliberadamente NO se
 * exporta: es una función privada de este fichero, así que ningún otro módulo de este
 * paquete (ni por tanto ningún subproyecto externo) puede importarla -- no existe un
 * nombre `serviceClient` exportado que atrapar (`import { serviceClient } from
 * "./client.js"` desde otro fichero es un error de compilación, TS2459: "declares
 * 'serviceClient' locally, but it is not exported"; ver el fixture en
 * `src/__compile_fixtures__` y `tests/integration/tenant-filter-structural.test.ts`).
 * El único código de todo el paquete que puede tocar Supabase sin pasar por
 * `tenantScoped`/`tenantsTableForHostResolution` es el que está en ESTE fichero.
 */
function serviceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias");
  }

  cached = createClient(url, key, {
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
  | "tables"
  | "orders"
  | "order_items"
  | "order_item_extras"
  | "printers"
  // Task 3 (D2, generación del código de emparejamiento, `src/admin-devices.ts`):
  // `devices` tiene `tenant_id` igual que el resto de esta unión y encaja sin más.
  // NO sustituye a `devicesTableForPairing` (quinta exención más abajo): esa sigue
  // siendo la única vía para el canje por `pairing_code` -- una búsqueda que, por
  // definición, ocurre ANTES de que el llamante conozca el tenant, así que no puede
  // pasar por `tenantScoped`. `tenantScoped("devices", tenantId)` es para el lado
  // contrario: crear/listar/borrar dispositivos cuando el tenant YA se conoce
  // (sesión de owner/admin en el panel).
  | "devices";

/**
 * ÚNICO punto de entrada a una tabla tenant-scoped desde este paquete. `tenantId` es un
 * parámetro obligatorio -- sin `?`, sin default -- así que omitirlo es un error de
 * compilación (TS2554: "Expected 2 arguments, but got 1"), no un bug que dependa de que
 * alguien recuerde escribir `.eq('tenant_id', tenantId)` en cada función repositorio.
 *
 * El filtro se aplica DENTRO de `select`, antes de devolver el builder: quien llama solo
 * puede encadenar condiciones ADICIONALES (`.eq(...)`, `.order(...)`, `.maybeSingle()`...)
 * sobre un resultado que ya viene acotado al tenant -- no hay forma de "quitar" el filtro
 * base desde fuera, porque nunca se expone el builder sin él.
 */
export function tenantScoped(table: TenantScopedTable, tenantId: string) {
  return {
    // Genérico sobre `Query`, igual que el `.select()` nativo de postgrest-js: si
    // `columns` se tipara como `string` a secas (en vez de preservar el literal que
    // recibe cada llamada), postgrest-js no puede parsear qué columnas se pidieron y el
    // resultado se degrada a `GenericStringError` en vez de la forma real de la fila.
    select<Query extends string = "*">(columns: Query) {
      return serviceClient().from(table).select(columns).eq("tenant_id", tenantId);
    },

    /**
     * `tenant_id` se sobreescribe DESPUÉS de esparcir la fila, así que un
     * `tenant_id` ajeno que venga en los datos no puede colarse: el del
     * parámetro siempre gana.
     */
    insert<Row extends Record<string, unknown>>(rows: Row | Row[]) {
      const list = Array.isArray(rows) ? rows : [rows];
      const scoped = list.map((row) => ({ ...row, tenant_id: tenantId }));
      return serviceClient().from(table).insert(scoped);
    },

    /**
     * `tenant_id` se elimina de los valores (no tiene sentido reasignar una fila
     * a otro tenant) y el filtro se aplica antes de devolver el builder.
     */
    update(values: Record<string, unknown>) {
      const { tenant_id: _ignored, ...rest } = values;
      return serviceClient().from(table).update(rest).eq("tenant_id", tenantId);
    },

    /**
     * Igual que `insert`, pero como UPSERT sobre `onConflict` (columnas separadas por
     * coma, tal como las espera postgrest-js): si ya existe una fila con esa clave,
     * la actualiza en vez de fallar contra la restricción única/PK. Añadido para
     * `pairDevice` (`src/devices.ts`, fix de la cuenta huérfana): un reintento tras un
     * fallo parcial de emparejamiento debe poder volver a intentar la membership del
     * dispositivo sin reventar contra la PK (`user_id, tenant_id`) de una fila que ya
     * dejó un intento anterior a medio camino.
     */
    upsert<Row extends Record<string, unknown>>(row: Row, onConflict: string) {
      const { tenant_id: _ignored, ...rest } = row as Record<string, unknown>;
      const scoped = { ...rest, tenant_id: tenantId };
      return serviceClient().from(table).upsert(scoped, { onConflict });
    },

    /**
     * El filtro de tenant se aplica ANTES de devolver el builder, igual que en
     * `select`/`update`: quien llama solo puede acotar el DELETE más (`.eq("id", ...)`,
     * ...) sobre un conjunto que ya está limitado a `tenant_id = tenantId` -- no hay
     * forma de borrar una fila de otro tenant pasando su id, porque el WHERE de tenant ya
     * está fijado antes de que el llamante añada nada. Añadido para el CRUD de catálogo
     * de administración (`src/admin-catalog.ts`): ningún repositorio anterior a este
     * necesitaba borrar filas.
     */
    delete() {
      return serviceClient().from(table).delete().eq("tenant_id", tenantId);
    },
  };
}

/**
 * EXENCIÓN DELIBERADA a la regla de arriba, acotada por firma a la tabla `tenants` (no un
 * `serviceClient()` genérico ni un parámetro de tabla): `tenants` no tiene `tenant_id`
 * propio (se identifica por su propia `id`), así que no encaja en `tenantScoped`.
 * Ningún otro código puede colarse por aquí para leer sin filtro ninguna otra tabla.
 * Esto NO es un escape hatch de propósito general -- si en el futuro hace falta otro
 * acceso sin `tenant_id` a una tabla DISTINTA, necesita su propio accessor igual de
 * estrecho y documentado, no una reutilización de este. Dos usos legítimos, ambos
 * búsquedas de una sola fila (nunca un barrido):
 *   1. `findTenantByHost` (`./tenants.js`): resuelve qué tenant corresponde al header
 *      `Host` de la petición ANTES de que exista ningún tenantId -- es precisamente la
 *      búsqueda que determina cuál es el tenant, así que no puede filtrarse por `id`
 *      (es justo lo que se busca resolver). Filtra por `slug`/`custom_domain`, cada uno
 *      con índice único.
 *   2. `getTenantStripeAccount` (`./tenants.js`): lee la fila del PROPIO tenant por su
 *      `id` (primary key) una vez que `tenantId` ya se conoce -- no es una búsqueda de
 *      resolución de host, pero sigue siendo una consulta de una sola fila acotada por
 *      clave única, y `tenants` no admite `tenantScoped` por el mismo motivo que el
 *      caso 1 (sin columna `tenant_id`). No amplía lo que este accessor puede hacer:
 *      sigue siendo lectura de una sola fila de `tenants`, nunca un barrido.
 */
export function tenantsTableForHostResolution() {
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
 * TERCERA EXENCIÓN DELIBERADA, con dos usos legítimos, ambos búsquedas por una
 * columna con índice único global (devuelven una fila o ninguna, nunca pueden
 * usarse para barrer datos de nadie):
 *   1. El webhook de Stripe identifica el pedido por `stripe_payment_intent_id`
 *      (columna `unique`) y no sabe nada de tenants: Stripe no los conoce.
 *   2. `getOrderByPublicToken` resuelve el estado de un pedido para el cliente
 *      (consulta de invitado, sin sesión) por `public_token` (índice único
 *      `orders_public_token_idx`) -- igual que el token de mesa, es lo que
 *      identifica la fila antes de que exista ningún tenant conocido.
 * Acotado por firma a `orders`; no es un escape hatch de propósito general.
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
 * QUINTA EXENCIÓN DELIBERADA, mismo razonamiento que `ordersTableForPaymentResolution`:
 * el emparejamiento de un dispositivo se busca por `pairing_code` (índice único parcial
 * `devices_pairing_code_idx`, ver la migración), y en ese momento el llamante todavía no
 * conoce el tenant -- es precisamente esa búsqueda la que lo revela. Acotado por firma a
 * `devices`; no es un escape hatch de propósito general. Se reutiliza también para el
 * canje atómico en sí (un único `UPDATE ... WHERE pairing_code = $1 AND
 * pairing_expires_at > now() ... RETURNING` que borra el código y fija `paired_at` en la
 * MISMA sentencia, sin SELECT previo -- ver `pairDevice` en `src/devices.ts` para el
 * razonamiento de atomicidad bajo concurrencia) y para el UPDATE posterior que enlaza
 * `auth_user_id` tras crear/recuperar la cuenta: en ese punto la fila ya se identifica
 * por su `id` (primary key), así que sigue siendo una operación de una sola fila
 * conocida, nunca un barrido.
 */
export function devicesTableForPairing() {
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
 * OCTAVA EXENCIÓN DELIBERADA. Devuelve el accessor de Storage ya atado al bucket
 * `catalog` (`.storage.from("catalog")`), NO `.storage` a secas -- así, igual que
 * `tenantScoped` ata cada llamada a UNA tabla, esta función ata cada llamada a UN
 * bucket: quien la use puede subir/listar objetos de `catalog`, pero no puede pedir
 * ningún otro bucket ni colarse a ninguna tabla sin pasar por `tenantScoped`. El
 * bucket `catalog` (ver `supabase/migrations/20260722000007_catalog_storage.sql`) es
 * público en lectura y sin policies de escritura para anon/authenticated: solo el
 * service role escribe, y solo a través de esta función. Acotado por firma a
 * `uploadProductImage` (`src/storage.ts`), el único punto del paquete que sube
 * imágenes de producto.
 */
export function catalogBucket() {
  return serviceClient().storage.from("catalog");
}

/**
 * NOVENA EXENCIÓN DELIBERADA. Los 14 alérgenos globales de la UE (`tenant_id` NULL, ver
 * `20260721000002_catalog.sql`) son un catálogo de referencia compartido por todos los
 * tenants -- no pertenecen a ninguno, así que no encajan en `tenantScoped` (que exige
 * `tenant_id = tenantId`) ni tiene sentido inventarles un tenant ficticio para colarlos
 * ahí. El filtro `tenant_id is null` va DENTRO de esta función, no expuesto como
 * parámetro: quien llama solo puede pedir "los globales", nunca los de un tenant
 * arbitrario (para eso ya existe `tenantScoped("allergens", tenantId)`). Acotado por
 * firma a `listAssignableAllergens` (`src/admin-catalog.ts`, Task 5): el formulario de
 * producto del panel de administración necesita ofrecer como casillas los 14 globales
 * MÁS los propios del tenant, y `listAdminCatalog` deliberadamente solo devuelve estos
 * últimos (ver su docstring).
 */
export function globalAllergensTable() {
  return serviceClient().from("allergens").select("id, name_i18n, icon").is("tenant_id", null);
}
