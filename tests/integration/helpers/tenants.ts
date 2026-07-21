import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceKey) {
  throw new Error('Faltan variables en .env.test. Ejecuta `pnpm db:env`.')
}

export const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export type TenantFixture = {
  tenantId: string
  slug: string
  email: string
  client: SupabaseClient
}

const PASSWORD = 'fixture-password-1234'

export async function createTenantFixture(slug: string): Promise<TenantFixture> {
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ slug, name: slug })
    .select('id')
    .single()
  if (tenantError) throw tenantError

  const email = `${slug}@fixture.local`
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  })
  if (userError) throw userError

  const { error: membershipError } = await admin
    .from('memberships')
    .insert({ user_id: user.user.id, tenant_id: tenant.id, role: 'owner' })
  if (membershipError) throw membershipError

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInError) throw signInError

  return { tenantId: tenant.id, slug, email, client }
}

export async function seedCatalog(tenantId: string, label: string): Promise<void> {
  const { data: category, error: categoryError } = await admin
    .from('categories')
    .insert({ tenant_id: tenantId, slug: `cat-${label}`, name_i18n: { es: `Cat ${label}` } })
    .select('id')
    .single()
  if (categoryError) throw categoryError

  const { data: product, error: productError } = await admin
    .from('products')
    .insert({
      tenant_id: tenantId,
      category_id: category.id,
      name_i18n: { es: `Prod ${label}` },
      price: 9.5,
    })
    .select('id')
    .single()
  if (productError) throw productError

  const { error: extraError } = await admin.from('product_extras').insert({
    tenant_id: tenantId,
    product_id: product.id,
    name_i18n: { es: `Extra ${label}` },
    price: 1.5,
  })
  if (extraError) throw extraError

  const { error: venueError } = await admin
    .from('venues')
    .insert({ tenant_id: tenantId, slug: 'principal', name: 'Principal', is_default: true })
  if (venueError) throw venueError

  const { error: settingsError } = await admin
    .from('tenant_settings')
    .insert({ tenant_id: tenantId, branding: { colors: { primary: '#000000' } } })
  if (settingsError) throw settingsError
}

/** Tablas de public con columna tenant_id, descubiertas en runtime. */
export async function listTenantScopedTables(): Promise<string[]> {
  const { data, error } = await admin.rpc('list_tenant_scoped_tables')
  if (error) throw error
  return (data as { table_name: string }[]).map((row) => row.table_name)
}
