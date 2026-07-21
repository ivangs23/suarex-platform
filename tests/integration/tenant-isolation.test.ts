import { beforeAll, describe, expect, it } from 'vitest'
import {
  admin,
  createTenantFixture,
  listTenantScopedTables,
  seedCatalog,
  type TenantFixture,
} from './helpers/tenants.js'

/** Tablas cuya lectura admite filas compartidas (tenant_id NULL), declaradas a propósito. */
const SHARED_READ_TABLES = new Set(['allergens'])

let tenantA: TenantFixture
let tenantB: TenantFixture
let tables: string[]

beforeAll(async () => {
  for (const table of ['product_extras', 'products', 'categories', 'venues', 'tenant_settings']) {
    await admin.from(table).delete().not('tenant_id', 'is', null)
  }
  await admin.from('tenants').delete().like('slug', 'leak-%')

  tenantA = await createTenantFixture(`leak-a-${Date.now()}`)
  tenantB = await createTenantFixture(`leak-b-${Date.now()}`)
  await seedCatalog(tenantA.tenantId, 'a')
  await seedCatalog(tenantB.tenantId, 'b')

  tables = await listTenantScopedTables()
})

it('descubre al menos las tablas de dominio conocidas', () => {
  expect(tables).toEqual(
    expect.arrayContaining([
      'allergens',
      'categories',
      'memberships',
      'product_extras',
      'products',
      'tenant_settings',
      'venues',
    ]),
  )
})

describe('aislamiento entre tenants', () => {
  it('cada tabla con tenant_id tiene RLS activada', async () => {
    const { data, error } = await admin.rpc('list_tenant_scoped_tables')
    expect(error).toBeNull()
    const names = (data as { table_name: string }[]).map((r) => r.table_name)

    for (const table of names) {
      const { data: rls } = await admin
        .from('pg_tables_rls_check')
        .select('*')
        .eq('tablename', table)
        .maybeSingle()
      expect(rls?.rowsecurity, `${table} sin RLS`).toBe(true)
    }
  })

  it('SELECT nunca devuelve filas de otro tenant', async () => {
    for (const table of tables) {
      const { data, error } = await tenantA.client.from(table).select('tenant_id')
      expect(error, `${table}: SELECT devolvió error inesperado`).toBeNull()

      const foreign = (data ?? []).filter((row) => {
        const value = (row as { tenant_id: string | null }).tenant_id
        if (value === null) return !SHARED_READ_TABLES.has(table)
        return value !== tenantA.tenantId
      })
      expect(foreign, `${table}: fuga de ${foreign.length} filas`).toHaveLength(0)
    }
  })

  it('INSERT con el tenant_id de otro es rechazado', async () => {
    for (const table of ['categories', 'venues', 'tenant_settings']) {
      const payload: Record<string, unknown> = { tenant_id: tenantB.tenantId }
      if (table === 'categories') {
        payload.slug = `intruso-${Date.now()}`
        payload.name_i18n = { es: 'Intruso' }
      }
      if (table === 'venues') {
        payload.slug = `intruso-${Date.now()}`
        payload.name = 'Intruso'
      }

      const { error } = await tenantA.client.from(table).insert(payload)
      expect(error, `${table}: INSERT cross-tenant NO fue rechazado`).not.toBeNull()
    }
  })

  it('UPDATE sobre filas de otro tenant no afecta a ninguna fila', async () => {
    const { data } = await tenantA.client
      .from('categories')
      .update({ sort_order: 999 })
      .eq('tenant_id', tenantB.tenantId)
      .select('id')
    expect(data ?? []).toHaveLength(0)

    const { data: intact } = await admin
      .from('categories')
      .select('sort_order')
      .eq('tenant_id', tenantB.tenantId)
    expect((intact ?? []).every((row) => row.sort_order === 0)).toBe(true)
  })

  it('DELETE sobre filas de otro tenant no borra nada', async () => {
    const before = await admin
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantB.tenantId)

    await tenantA.client.from('categories').delete().eq('tenant_id', tenantB.tenantId)

    const after = await admin
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantB.tenantId)
    expect(after.count).toBe(before.count)
  })
})
