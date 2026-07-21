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
  | "product_extras";

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
