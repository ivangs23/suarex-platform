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
  | "order_item_extras";

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
  };
}

/**
 * EXENCIÓN DELIBERADA Y ÚNICA a la regla de arriba. `findTenantByHost` resuelve qué
 * tenant corresponde al header `Host` de la petición ANTES de que exista ningún
 * tenantId -- es precisamente la búsqueda que determina cuál es el tenant, así que no
 * puede filtrarse por `tenant_id` (esa columna ni siquiera existe en `tenants`) ni por
 * `id` (es justo lo que se busca resolver).
 *
 * Por eso tiene su propio accessor, con nombre explícito y acotado por firma a la tabla
 * `tenants` (no un `serviceClient()` genérico ni un parámetro de tabla): ningún otro
 * código puede colarse por aquí para leer sin filtro ninguna otra tabla. Esto NO es un
 * escape hatch de propósito general -- si en el futuro hace falta otro acceso sin
 * tenant_id, necesita su propio accessor igual de estrecho y documentado, no una
 * reutilización de este.
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
