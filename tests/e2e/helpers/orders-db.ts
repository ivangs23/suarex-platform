import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = process.env.SUPABASE_URL;
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!rawUrl || !rawServiceKey) {
  throw new Error(
    "Faltan SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en .env.test. Corre `pnpm db:env`.",
  );
}

const url: string = rawUrl;
const serviceKey: string = rawServiceKey;

/**
 * Cliente de servicio EXCLUSIVO de `tests/e2e/staff-board.spec.ts`, con un único trabajo:
 * localizar y borrar, por su propio id, exactamente los pedidos que ESE test creó.
 *
 * Por qué hace falta esto en vez de confiar en "marcar hecho": marcar una estación
 * `done` cambia `status` a `served` (ver `markStationDone` en
 * `packages/db/src/staff-orders.ts`) y ESO es lo que hace que `listActiveOrders` deje de
 * devolver la fila -- pero la fila sigue existiendo. Que un pedido desaparezca del
 * tablero es un efecto del filtro de `listActiveOrders`, no una limpieza; confundir los
 * dos es exactamente lo que dejó pedidos `pending` huérfanos en la base cada vez que una
 * ejecución anterior de esta suite falló a mitad de test (antes de llegar al "marcar
 * hecho"), y por qué la siguiente ejecución arrancaba con el tablero ya no-vacío. Un test
 * es dueño de los pedidos que crea y los borra él mismo en un `finally`, pase lo que pase
 * durante el test -- ver brief de la tarea.
 */
const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export type CreatedOrder = { orderId: string; orderNumber: number };

/**
 * `POST /api/orders` (API pública, ver `apps/web/app/api/orders/route.ts`) solo devuelve
 * `clientSecret`/`publicToken` -- nunca el id interno del pedido, a propósito, porque un
 * comensal anónimo no tiene por qué conocerlo. Este helper resuelve ese id (y el número
 * visible en el tablero) a partir del `publicToken` que la API sí expone, usando la
 * misma columna única (`orders_public_token_idx`) que `getOrderByPublicToken` en
 * `packages/db/src/orders.ts`.
 */
export async function findOrderByPublicToken(publicToken: string): Promise<CreatedOrder> {
  const { data, error } = await admin
    .from("orders")
    .select("id, order_number")
    .eq("public_token", publicToken)
    .single();
  if (error) throw error;
  return { orderId: data.id as string, orderNumber: data.order_number as number };
}

/**
 * Borra el pedido por id. `order_items`/`order_item_extras` caen en cascada (`on delete
 * cascade` sobre `order_id`/`order_item_id`, ver `20260721000005_orders.sql`), así que
 * este único delete basta. Se llama SIEMPRE desde un `finally` en el test, con o sin
 * fallo: cada test deja la base exactamente como la encontró.
 */
export async function deleteOrder(orderId: string): Promise<void> {
  const { error } = await admin.from("orders").delete().eq("id", orderId);
  if (error) throw error;
}

/**
 * Fix round 2 (Finding 3): `POST /api/orders` deja el pedido en `status: "pending"` --
 * el webhook de Stripe (`apps/web/app/api/webhook/stripe/route.ts`, fuera de alcance de
 * este fix) es quien lo marca `paid` en el mundo real, y este e2e nunca completa un
 * cobro de verdad, así que ese webhook no llega a dispararse. Con el trigger
 * `orders_auto_serve` (`20260721000008_orders_auto_serve.sql`), un pedido `pending` con
 * ambas estaciones resueltas YA NO pasa a `served` -- por diseño, ver Finding 3 -- así
 * que este test necesita simular lo que haría ese webhook (un UPDATE directo a `status:
 * "paid"`, igual que `markOrderPaid` en `packages/db/src/orders.ts`) para poder seguir
 * probando que "marcar hecho" hace desaparecer un pedido YA PAGADO del tablero.
 */
export async function markOrderPaidForTest(orderId: string): Promise<void> {
  const { error } = await admin
    .from("orders")
    .update({ status: "paid" })
    .eq("id", orderId)
    .eq("status", "pending");
  if (error) throw error;
}

/**
 * Id de un producto de un tenant, para componer una comanda desde un test.
 *
 * Se lee de la base y no rascando el HTML de la carta, como se hacía antes. La carta se
 * navega por niveles: un producto solo se pinta si estás dentro de SU categoría, así que
 * rascar la raíz devolvía cero y un test fallaba por dónde miraba, no por lo que probaba.
 *
 * `destination` filtra por la estación a la que va el producto (`cocina`/`barra`). Un test
 * que compruebe en qué estación aparece la comanda TIENE que elegirlo: con un producto
 * cualquiera, el resultado depende del orden en que la base devuelva las filas, y ese test
 * pasa o falla por azar.
 */
export async function firstProductIdOfTenant(
  tenantSlug: string,
  destination?: "cocina" | "barra",
): Promise<string> {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();
  if (tenantError) throw tenantError;

  let query = admin
    .from("products")
    .select("id, categories!inner(destination)")
    .eq("tenant_id", tenant.id as string);
  if (destination) query = query.eq("categories.destination", destination);

  const { data, error } = await query.limit(1).single();
  if (error) throw error;

  return data.id as string;
}

/** Notas de las líneas de un pedido, para comprobar que lo que escribió el comensal llega
 *  a la comanda que se imprime en cocina -- y no se queda en el navegador. */
export async function orderLineNotes(orderId: string): Promise<(string | null)[]> {
  const { data, error } = await admin.from("order_items").select("notes").eq("order_id", orderId);
  if (error) throw error;
  return (data ?? []).map((row) => (row.notes as string | null) ?? null);
}

/**
 * Pedido más reciente de un tenant, por su slug. Lo usan los tests que crean el pedido por
 * la UI y ya no reciben el `publicToken` en una redirección: desde que el cobro ocurre en el
 * panel, "Pagar" abre el formulario de tarjeta en vez de saltar a `/pedido`. El pedido, en
 * cambio, existe (pending) en cuanto se pulsa Pagar -- `createPendingOrder` escribe las
 * líneas antes del cobro -- así que se localiza por ser el último de ese cliente.
 */
export async function latestOrderForTenant(tenantSlug: string): Promise<CreatedOrder> {
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();
  if (tErr) throw tErr;

  const { data, error } = await admin
    .from("orders")
    .select("id, order_number")
    .eq("tenant_id", tenant.id as string)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return { orderId: data.id as string, orderNumber: data.order_number as number };
}

/**
 * Borra TODOS los pedidos de un tenant. Lo usa el test del rate-limit, que crea varios
 * pedidos de golpe hasta chocar con el tope y no tiene un id concreto que limpiar.
 */
export async function deleteOrdersForTenant(tenantSlug: string): Promise<void> {
  const { data: tenant, error: tErr } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();
  if (tErr) throw tErr;
  const { error } = await admin
    .from("orders")
    .delete()
    .eq("tenant_id", tenant.id as string);
  if (error) throw error;
}

/** Vacía el contador de rate-limit de una clave (el id de una mesa), para que un test empiece
 *  con cupo limpio sin depender de lo que hicieran los tests anteriores en su misma ventana. */
export async function clearRateLimit(key: string): Promise<void> {
  const { error } = await admin.from("rate_limit_hits").delete().eq("key", key);
  if (error) throw error;
}

/** Id de la mesa que resuelve un token, para operar sobre su contador de rate-limit. */
export async function tableIdForToken(token: string): Promise<string> {
  const { data, error } = await admin.from("tables").select("id").eq("token", token).single();
  if (error) throw error;
  return data.id as string;
}

/** Vacía TODO el contador de rate-limit. Lo llama un `beforeEach` en los ficheros e2e que
 *  crean pedidos: sin esto, varios tests que piden en la misma mesa dentro de la ventana de
 *  2 min comparten cupo y el rate-limit (real en producción) haría fallar a los de después. */
export async function clearAllRateLimits(): Promise<void> {
  const { error } = await admin.from("rate_limit_hits").delete().neq("bucket", "__none__");
  if (error) throw error;
}
