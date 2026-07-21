import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl = process.env.SUPABASE_URL;
const rawAnonKey = process.env.SUPABASE_ANON_KEY;
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!rawUrl || !rawAnonKey || !rawServiceKey) {
  throw new Error("Faltan variables en .env.test. Ejecuta `pnpm db:env`.");
}

// Reasignadas a constantes con tipo `string` explícito (no `string | undefined`
// estrechado por control flow): el estrechamiento de `rawUrl`/`rawAnonKey`/`rawServiceKey`
// tras el `if` de arriba no se propaga dentro de los cuerpos de las funciones definidas
// más abajo en este módulo (createTenantFixture las captura como closures), así que sin
// esto `tsc --strict` seguiría viendo `string | undefined` ahí dentro.
const url: string = rawUrl;
const anonKey: string = rawAnonKey;
const serviceKey: string = rawServiceKey;

export const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export type TenantFixture = {
  tenantId: string;
  userId: string;
  slug: string;
  email: string;
  client: SupabaseClient;
};

/** Filas propias creadas por seedCatalog, usadas como referencias válidas en payloads cross-tenant. */
export type SeedResult = {
  categoryId: string;
  productId: string;
  venueId: string;
  orderId: string;
  orderItemId: string;
};

const PASSWORD = "fixture-password-1234";

/** Entropía para evitar colisiones (slug, dominio...) entre ejecuciones repetidas/concurrentes. */
export function nonce(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTenantFixture(slug: string): Promise<TenantFixture> {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ slug, name: slug })
    .select("id")
    .single();
  if (tenantError) throw tenantError;

  const email = `${slug}@fixture.local`;
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError) throw userError;

  const { error: membershipError } = await admin
    .from("memberships")
    .insert({ user_id: user.user.id, tenant_id: tenant.id, role: "owner" });
  if (membershipError) throw membershipError;

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  return { tenantId: tenant.id, userId: user.user.id, slug, email, client };
}

/**
 * Borra la fila de `tenants` y el usuario de auth creados por createTenantFixture.
 * Acotado por diseño: solo recibe el tenantId/userId concretos de la fixture (nunca un
 * patrón/wildcard), para que no pueda derivar en un borrado masivo de `tenants` o
 * `auth.users` por accidente. Borrar la fila de `tenants` primero es suficiente: las
 * FKs de catálogo (categories, products, product_extras, venues, tenant_settings,
 * memberships, allergens tenant-scoped) declaran `on delete cascade` sobre
 * `tenants.id`, así que sus filas desaparecen solas con este único delete.
 */
export async function deleteTenantFixture(fixture: TenantFixture): Promise<void> {
  const { error: tenantError } = await admin.from("tenants").delete().eq("id", fixture.tenantId);
  if (tenantError) throw tenantError;

  const { error: userError } = await admin.auth.admin.deleteUser(fixture.userId);
  if (userError) throw userError;
}

export async function seedCatalog(tenantId: string, label: string): Promise<SeedResult> {
  const { data: category, error: categoryError } = await admin
    .from("categories")
    .insert({ tenant_id: tenantId, slug: `cat-${label}`, name_i18n: { es: `Cat ${label}` } })
    .select("id")
    .single();
  if (categoryError) throw categoryError;

  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      category_id: category.id,
      name_i18n: { es: `Prod ${label}` },
      price: 9.5,
    })
    .select("id")
    .single();
  if (productError) throw productError;

  const { data: extra, error: extraError } = await admin
    .from("product_extras")
    .insert({
      tenant_id: tenantId,
      product_id: product.id,
      name_i18n: { es: `Extra ${label}` },
      price: 1.5,
    })
    .select("id")
    .single();
  if (extraError) throw extraError;

  const { data: venue, error: venueError } = await admin
    .from("venues")
    .insert({ tenant_id: tenantId, slug: "principal", name: "Principal", is_default: true })
    .select("id")
    .single();
  if (venueError) throw venueError;

  const { error: settingsError } = await admin
    .from("tenant_settings")
    .insert({ tenant_id: tenantId, branding: { colors: { primary: "#000000" } } });
  if (settingsError) throw settingsError;

  // allergens también es tenant-scoped (aparte de las 14 filas globales con tenant_id
  // NULL): cada tenant puede declarar sus propios alérgenos personalizados. Se siembra
  // aquí para que el control positivo de lectura y la cobertura de escritura cross-tenant
  // no traten esta tabla como excepción silenciosa.
  const { error: allergenError } = await admin
    .from("allergens")
    .insert({ tenant_id: tenantId, name_i18n: { es: `Alérgeno ${label}` } });
  if (allergenError) throw allergenError;

  // tables/order_counters también son tenant-scoped (mesas del local y contador de
  // pedidos por día): se siembra una fila de cada una aquí, igual que el resto de
  // tablas de este helper, para que tanto el control positivo de lectura como la
  // cobertura de escritura cross-tenant (WRITE_FIXTURES) tengan una fila real de este
  // tenant sobre la que operar.
  const { error: tableError } = await admin
    .from("tables")
    .insert({ tenant_id: tenantId, venue_id: venue.id, label: `mesa-${label}` });
  if (tableError) throw tableError;

  const { error: counterError } = await admin
    .from("order_counters")
    .insert({ tenant_id: tenantId, venue_id: venue.id, date: "2026-01-01", last_number: 1 });
  if (counterError) throw counterError;

  // orders/order_items/order_item_extras también son tenant-scoped y quedan cubiertas por
  // el descubrimiento dinámico de listTenantScopedTables(): sin una fila propia sembrada
  // aquí, el control positivo de "SELECT ve las propias filas" y los de UPDATE/DELETE
  // cross-tenant (que exigen una fila real de B sobre la que operar) fallarían por falta
  // de datos, no por un fallo real de aislamiento. Se referencia el product/extra reales
  // creados arriba para que las filas sean válidas en todo lo demás (NOT NULL, FKs).
  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({ tenant_id: tenantId, venue_id: venue.id, order_number: 1 })
    .select("id")
    .single();
  if (orderError) throw orderError;

  const { data: orderItem, error: orderItemError } = await admin
    .from("order_items")
    .insert({
      tenant_id: tenantId,
      order_id: order.id,
      product_id: product.id,
      name_snapshot: { es: `Prod ${label}` },
      unit_price: 9.5,
      quantity: 1,
      line_total: 9.5,
      destination: "cocina",
    })
    .select("id")
    .single();
  if (orderItemError) throw orderItemError;

  const { error: orderItemExtraError } = await admin.from("order_item_extras").insert({
    tenant_id: tenantId,
    order_item_id: orderItem.id,
    extra_id: extra.id,
    name_snapshot: { es: `Extra ${label}` },
    price: 1.5,
  });
  if (orderItemExtraError) throw orderItemExtraError;

  return {
    categoryId: category.id,
    productId: product.id,
    venueId: venue.id,
    orderId: order.id,
    orderItemId: orderItem.id,
  };
}

/** Tablas de public con columna tenant_id, descubiertas en runtime. */
export async function listTenantScopedTables(): Promise<string[]> {
  const { data, error } = await admin.rpc("list_tenant_scoped_tables");
  if (error) throw error;
  return (data as { table_name: string }[]).map((row) => row.table_name);
}
