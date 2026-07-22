import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPermittedPolicyForm, type PolicyRow } from "./helpers/policy-check.js";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  listTenantScopedTables,
  nonce,
  type SeedResult,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

/** Tablas cuya lectura admite filas compartidas (tenant_id NULL), declaradas a propósito. */
const SHARED_READ_TABLES = new Set(["allergens"]);

/**
 * Columna que delimita el tenant en cada tabla descubierta. Todas usan `tenant_id`
 * salvo `tenants`, que se aísla por su propia `id` (ver
 * `20260721000003_test_introspection.sql` y `helpers/policy-check.ts`): la fila
 * "propia" de un tenant en `tenants` es la que tiene `id = <su tenantId>`, no una con
 * `tenant_id = <su tenantId>` (esa columna ni siquiera existe en esa tabla).
 */
const SCOPE_COLUMN: Record<string, string> = { tenants: "id" };
function scopeColumnFor(table: string): string {
  return SCOPE_COLUMN[table] ?? "tenant_id";
}

type WriteFixtureCtx = {
  tenantA: TenantFixture;
  tenantB: TenantFixture;
  seedB: SeedResult;
};

type WriteFixture = {
  /** Payload de INSERT que, como tenant A, intenta crear una fila para el tenant B.
   *  Debe ser válido en todo lo demás (NOT NULL, FKs) para que la ÚNICA razón de
   *  rechazo posible sea una guarda de aislamiento deliberada (RLS o el trigger
   *  assert_same_tenant), nunca un fallo incidental (NOT NULL, FK inexistente...). */
  insertPayload: (ctx: WriteFixtureCtx) => Record<string, unknown>;
  /**
   * Código de error de Postgres esperado y, opcionalmente, un fragmento del mensaje que
   * debe contener. Por defecto es el rechazo de RLS (42501). categories/products/
   * product_extras tienen además el trigger `assert_same_tenant` (BEFORE INSERT), que
   * al ejecutarse con los privilegios (y por tanto la RLS) del invocador no puede ver la
   * fila padre de otro tenant y dispara su propia excepción (P0001) ANTES de que la
   * cláusula WITH CHECK de la policy llegue a evaluarse. Es una guarda igual de real y
   * deliberada, solo que en una capa distinta: se declara explícitamente aquí en vez de
   * asumir un único código para todas las tablas.
   */
  expectedInsertRejection: { code: string; messageIncludes?: string };
  /** Columna+valor usados para el intento de UPDATE cross-tenant sobre la fila de B. */
  updateColumn: string;
  updateValue: unknown;
  /**
   * Por defecto, el UPDATE cross-tenant se espera SIN error (la policy `USING` filtra la
   * fila del candidate set y el UPDATE simplemente afecta 0 filas). Declarar esto anula
   * ese default cuando la tabla revoca el privilegio UPDATE a `authenticated` a nivel de
   * GRANT (ver `order_counters` más abajo, ronda de fix de seguridad #1): en ese caso
   * Postgres rechaza el UPDATE entero con "permission denied" antes de que RLS llegue a
   * filtrar nada, así que SÍ hay un error, y es ese, no ausencia de error.
   */
  expectedUpdateRejection?: { code: string; messageIncludes?: string };
};

const RLS_REJECTION = { code: "42501" };
const SAME_TENANT_TRIGGER_REJECTION = {
  code: "P0001",
  messageIncludes: "cross-tenant reference rejected",
};

/**
 * Configuración de CÓMO probar cada tabla en el camino de escritura. Esto NO filtra qué
 * tablas se testean (esas se descubren dinámicamente vía listTenantScopedTables()): si una
 * tabla descubierta no tiene entrada aquí, el test falla explícitamente nombrándola, para
 * que una tabla nueva no pueda escapar en silencio a la cobertura de escritura.
 */
const WRITE_FIXTURES: Record<string, WriteFixture> = {
  categories: {
    // parent_id queda null: el trigger assert_same_tenant se cortocircuita en ese caso
    // (ver su código), así que aquí el rechazo observado es genuinamente el de RLS.
    insertPayload: ({ tenantB }) => ({
      tenant_id: tenantB.tenantId,
      slug: `intruso-cat-${nonce()}`,
      name_i18n: { es: "Intruso" },
    }),
    expectedInsertRejection: RLS_REJECTION,
    updateColumn: "sort_order",
    updateValue: 999,
  },
  venues: {
    insertPayload: ({ tenantB }) => ({
      tenant_id: tenantB.tenantId,
      slug: `intruso-venue-${nonce()}`,
      name: "Intruso",
    }),
    expectedInsertRejection: RLS_REJECTION,
    updateColumn: "timezone",
    updateValue: "Pacific/Auckland",
  },
  tenant_settings: {
    insertPayload: ({ tenantB }) => ({
      tenant_id: tenantB.tenantId,
      branding: { colors: { primary: "#000000" } },
    }),
    expectedInsertRejection: RLS_REJECTION,
    updateColumn: "locale",
    updateValue: "en",
  },
  products: {
    // category_id apunta a la categoría real de B: para que el trigger la aceptase
    // haría falta verla, y como A no tiene visibilidad de datos de B bajo su propia RLS,
    // el trigger (no security definer) dispara P0001 antes de que la policy de products
    // llegue a evaluar su WITH CHECK. Ver SAME_TENANT_TRIGGER_REJECTION.
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      category_id: seedB.categoryId,
      name_i18n: { es: "Intruso" },
      price: 9.5,
    }),
    expectedInsertRejection: SAME_TENANT_TRIGGER_REJECTION,
    updateColumn: "sort_order",
    updateValue: 999,
  },
  product_extras: {
    // Mismo razonamiento que products: product_id pertenece a B y es invisible para A.
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      product_id: seedB.productId,
      name_i18n: { es: "Intruso" },
      price: 1.5,
    }),
    expectedInsertRejection: SAME_TENANT_TRIGGER_REJECTION,
    updateColumn: "price",
    updateValue: 999.99,
  },
  memberships: {
    // El ataque más relevante: A intenta auto-concederse membresía en el tenant de B.
    // Tras la ronda de fix de seguridad #3 (20260721000006_memberships_lockdown.sql),
    // INSERT/UPDATE/DELETE/TRUNCATE se revocaron por completo de `authenticated` sobre
    // esta tabla, así que ambos rechazos siguen siendo 42501 pero ahora por falta de
    // privilegio, no porque la policy los filtre.
    insertPayload: ({ tenantA, tenantB }) => ({
      tenant_id: tenantB.tenantId,
      user_id: tenantA.userId,
      role: "owner",
    }),
    expectedInsertRejection: RLS_REJECTION,
    updateColumn: "role",
    updateValue: "admin",
    // Antes de la revocación, el UPDATE cross-tenant no daba error: la policy `USING`
    // filtraba la fila de B y el UPDATE afectaba 0 filas en silencio. Ahora el privilegio
    // UPDATE ya no existe para `authenticated`, así que Postgres rechaza el UPDATE entero
    // con "permission denied" antes de que RLS llegue a filtrar nada -- mismo patrón que
    // order_counters más abajo. Es un comportamiento mejor (rechazo explícito en vez de
    // éxito silencioso), no una relajación del test.
    expectedUpdateRejection: { code: "42501", messageIncludes: "permission denied" },
  },
  allergens: {
    insertPayload: ({ tenantB }) => ({
      tenant_id: tenantB.tenantId,
      name_i18n: { es: "Intruso" },
    }),
    expectedInsertRejection: RLS_REJECTION,
    updateColumn: "icon",
    updateValue: "intruso",
  },
  tenants: {
    // Ataque: A (current_tenant_id() = tenantA.tenantId) intenta insertar una fila de
    // `tenants` reclamando la identidad de B (`id: tenantB.tenantId`). Confirmado
    // empíricamente contra la base local que el WITH CHECK de RLS (ExecWithCheckOptions)
    // se evalúa ANTES de que el índice único de `id` pueda siquiera rechazar el
    // duplicado, así que el 42501 observado es genuinamente el de RLS, no un efecto
    // colateral de reusar un id ya existente.
    insertPayload: ({ tenantB }) => ({
      id: tenantB.tenantId,
      slug: `intruso-tenant-${nonce()}`,
      name: "Intruso",
    }),
    expectedInsertRejection: RLS_REJECTION,
    updateColumn: "plan",
    updateValue: "hacked",
  },
  tables: {
    // venue_id apunta al venue real de B (seedB.venueId, sembrado por seedCatalog) para
    // que la única razón de rechazo posible sea una guarda de aislamiento deliberada,
    // nunca una FK inexistente; label lleva nonce() para no chocar con la unique
    // (tenant_id, venue_id, label) de la mesa ya sembrada de B.
    //
    // tenant_id y venue_id aquí SÍ pertenecen al mismo tenant (B), así que el trigger
    // `assert_same_tenant` (ronda de fix de seguridad #2, ver 20260721000004_tables.sql)
    // no ve ninguna discrepancia de tenants -- PERO, igual que en products/product_extras,
    // ese trigger consulta `public.venues` con los privilegios (y por tanto la RLS) del
    // invocador: A no puede ver el venue de B bajo su propia RLS, así que la subconsulta
    // devuelve 0 filas, `parent_tenant` queda NULL, y el trigger dispara su propia
    // excepción (P0001) ANTES de que el WITH CHECK de `tables_isolation` llegue a
    // evaluarse. Es la misma guarda de aislamiento real, solo en la capa del trigger en
    // vez de en la de RLS -- ver SAME_TENANT_TRIGGER_REJECTION.
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      venue_id: seedB.venueId,
      label: `intruso-mesa-${nonce()}`,
    }),
    expectedInsertRejection: SAME_TENANT_TRIGGER_REJECTION,
    updateColumn: "sort_order",
    updateValue: 999,
  },
  order_counters: {
    // Misma lógica que tables: venue_id real de B, pero con una fecha distinta a la
    // sembrada ("2026-01-01") para que la única causa de rechazo posible sea una guarda de
    // aislamiento deliberada, nunca un choque con la primary key (tenant_id, venue_id,
    // date) de la fila ya existente. Igual que en `tables`, el trigger
    // `assert_same_tenant` ahora cubre esta tabla y sería quien dispare P0001 -- pero
    // aquí nunca llega a evaluarse: la ronda de fix de seguridad #1 revocó INSERT (y
    // UPDATE/DELETE/TRUNCATE) de `authenticated` sobre order_counters (la única vía de
    // escritura debe ser next_order_number(), SECURITY DEFINER), así que Postgres rechaza
    // el INSERT entero por falta de privilegio ANTES de que dispare ningún trigger.
    // "permission denied for table" también es SQLSTATE 42501, igual que el RLS_REJECTION
    // original, así que el código esperado no cambia (solo cambia, internamente, en qué
    // capa se produce el rechazo).
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      venue_id: seedB.venueId,
      date: "2026-03-03",
    }),
    expectedInsertRejection: RLS_REJECTION,
    updateColumn: "last_number",
    updateValue: 999,
    // Mismo motivo que el INSERT de arriba: UPDATE fue revocado por completo a
    // `authenticated` (ronda de fix de seguridad #1), así que el intento de UPDATE
    // cross-tenant ya ni siquiera llega a que RLS lo filtre -- Postgres lo rechaza entero
    // con "permission denied", SQLSTATE 42501.
    expectedUpdateRejection: { code: "42501", messageIncludes: "permission denied" },
  },
  orders: {
    // venue_id apunta al venue real de B (seedB.venueId) para que la única razón de
    // rechazo posible sea una guarda de aislamiento deliberada, nunca una FK inexistente.
    // `orders` lleva su propio trigger assert_same_tenant (finding de autorreview, ver
    // 20260721000005_orders.sql) que resuelve `venues` bajo los privilegios (y por tanto
    // la RLS) del invocador: A no puede ver el venue real de B, la subconsulta devuelve 0
    // filas, `parent_tenant` queda NULL, y dispara P0001 antes de que el WITH CHECK de
    // orders_isolation llegue a evaluarse. Mismo patrón que tables/products.
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      venue_id: seedB.venueId,
      order_number: 1,
    }),
    expectedInsertRejection: SAME_TENANT_TRIGGER_REJECTION,
    updateColumn: "order_number",
    updateValue: 999,
  },
  order_items: {
    // order_id apunta al pedido real de B (seedB.orderId, sembrado por seedCatalog): A no
    // puede verlo bajo su propia RLS, así que la subconsulta del trigger assert_same_tenant
    // devuelve 0 filas, parent_tenant queda NULL, y dispara su propia excepción (P0001)
    // ANTES de que el WITH CHECK de order_items_isolation llegue a evaluarse. Mismo patrón
    // que products/tables. Ver SAME_TENANT_TRIGGER_REJECTION.
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      order_id: seedB.orderId,
      name_snapshot: { es: "Intruso" },
      unit_price: 1,
      quantity: 1,
      line_total: 1,
      destination: "cocina",
    }),
    expectedInsertRejection: SAME_TENANT_TRIGGER_REJECTION,
    updateColumn: "quantity",
    updateValue: 999,
  },
  order_item_extras: {
    // Mismo razonamiento que order_items: order_item_id apunta a la línea real de B
    // (seedB.orderItemId), invisible para A bajo su propia RLS.
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      order_item_id: seedB.orderItemId,
      name_snapshot: { es: "Intruso" },
      price: 1,
    }),
    expectedInsertRejection: SAME_TENANT_TRIGGER_REJECTION,
    updateColumn: "price",
    updateValue: 999,
  },
  devices: {
    // venue_id apunta al venue real de B (seedB.venueId, sembrado por seedCatalog). Mismo
    // razonamiento que tables/orders: el trigger assert_same_tenant (ver
    // 20260722000001_devices_printers.sql) resuelve `venues` bajo los privilegios (y por
    // tanto la RLS) del invocador -- A no puede ver el venue real de B, la subconsulta
    // devuelve 0 filas, `parent_tenant` queda NULL, y dispara P0001 antes de que el WITH
    // CHECK de devices_isolation llegue a evaluarse. Ver SAME_TENANT_TRIGGER_REJECTION.
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      venue_id: seedB.venueId,
      name: "Intruso",
    }),
    expectedInsertRejection: SAME_TENANT_TRIGGER_REJECTION,
    updateColumn: "name",
    updateValue: "hackeado",
  },
  printers: {
    // Mismo razonamiento que devices: venue_id real de B, invisible para A bajo su propia
    // RLS, dispara el trigger assert_same_tenant (rama `printers`, que comprueba primero
    // venue_id) antes de que la policy de printers_isolation llegue a evaluar su WITH
    // CHECK. device_id se omite (queda NULL): esta fixture ya cubre la rama de venue_id;
    // la rama de device_id del trigger sigue el mismo patrón y no necesita su propio caso
    // aquí para que la cobertura de escritura de esta tabla sea genuina.
    insertPayload: ({ tenantB, seedB }) => ({
      tenant_id: tenantB.tenantId,
      venue_id: seedB.venueId,
      name: "Intruso",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
    }),
    expectedInsertRejection: SAME_TENANT_TRIGGER_REJECTION,
    updateColumn: "name",
    updateValue: "hackeado",
  },
};

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let seedB: SeedResult;
let tables: string[];

afterAll(async () => {
  // Acotado a los dos usuarios creados por esta suite (nunca un wipe de auth.users).
  for (const fixture of [tenantA, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

beforeAll(async () => {
  tables = await listTenantScopedTables();

  // Limpieza acotada SOLO a las fixtures de esta suite (slugs `leak-%`), nunca a datos de
  // otros tenants del stack local compartido.
  const { data: leakTenants, error: leakTenantsError } = await admin
    .from("tenants")
    .select("id")
    .like("slug", "leak-%");
  if (leakTenantsError) throw leakTenantsError;
  const leakTenantIds = (leakTenants ?? []).map((row) => row.id as string);

  if (leakTenantIds.length > 0) {
    for (const table of tables) {
      // `tenants` está incluida en `tables` (ver list_tenant_scoped_tables) pero se
      // aísla por su propia `id`, no por `tenant_id`; sin esto, este delete fallaría en
      // silencio para esa tabla (columna inexistente) y quedaría cubierto igualmente
      // por el `.delete().like("slug", "leak-%")` de abajo -- pero es más claro no
      // depender de eso.
      await admin.from(table).delete().in(scopeColumnFor(table), leakTenantIds);
    }
  }
  await admin.from("tenants").delete().like("slug", "leak-%");

  tenantA = await createTenantFixture(`leak-a-${nonce()}`);
  tenantB = await createTenantFixture(`leak-b-${nonce()}`);
  await seedCatalog(tenantA.tenantId, "a");
  seedB = await seedCatalog(tenantB.tenantId, "b");
});

it("descubre al menos las tablas de dominio conocidas", () => {
  expect(tables).toEqual(
    expect.arrayContaining([
      "allergens",
      "categories",
      "memberships",
      "product_extras",
      "products",
      "tenant_settings",
      "tenants",
      "venues",
    ]),
  );
});

describe("aislamiento entre tenants", () => {
  it("cada tabla con tenant_id tiene RLS activada", async () => {
    expect(tables.length, "no se descubrieron tablas con tenant_id").toBeGreaterThan(0);

    for (const table of tables) {
      const { data: rls, error: rlsError } = await admin
        .from("pg_tables_rls_check")
        .select("*")
        .eq("tablename", table)
        .maybeSingle();
      expect(rlsError, `${table}: error consultando pg_tables_rls_check`).toBeNull();
      expect(rls?.rowsecurity, `${table} sin RLS`).toBe(true);
    }
  });

  it("el rol anon no tiene ningún privilegio sobre ninguna tabla tenant-scoped descubierta", async () => {
    // Los privilegios por defecto de Postgres re-conceden a `anon` en cada tabla nueva de
    // public; cada migración termina con un `revoke all ... from anon` explícito que hay
    // que recordar escribir. RLS-enabled ya se auto-verifica arriba; esto cierra el mismo
    // hueco para los GRANTs, para esta tabla y para cualquiera que añadan los
    // subproyectos 2-6.
    expect(tables.length, "no se descubrieron tablas con tenant_id").toBeGreaterThan(0);

    const { data, error } = await admin
      .from("pg_anon_grants_check")
      .select("*")
      .in("tablename", tables);
    expect(error, "error consultando pg_anon_grants_check").toBeNull();
    const grants = (data ?? []) as { tablename: string; privilege_type: string }[];

    for (const table of tables) {
      const tableGrants = grants.filter((g) => g.tablename === table);
      expect(
        tableGrants,
        `${table}: anon tiene privilegio(s) [${tableGrants.map((g) => g.privilege_type).join(", ")}] -- añade 'revoke all on public.${table} from anon' a su migración`,
      ).toHaveLength(0);
    }
  });

  it("cada policy de tablas tenant-scoped usa una forma canónica exactamente permitida en USING/WITH CHECK", async () => {
    expect(tables.length, "no se descubrieron tablas con tenant_id").toBeGreaterThan(0);

    const { data, error } = await admin
      .from("pg_policies_tenant_check")
      .select("*")
      .in("tablename", tables);
    expect(error, "error consultando pg_policies_tenant_check").toBeNull();
    const policies = (data ?? []) as PolicyRow[];

    for (const table of tables) {
      const tablePolicies = policies.filter((p) => p.tablename === table);
      expect(tablePolicies.length, `${table}: no tiene ninguna policy de RLS`).toBeGreaterThan(0);

      for (const policy of tablePolicies) {
        // Semántica de Postgres: USING aplica a SELECT/UPDATE/DELETE/ALL;
        // WITH CHECK aplica a INSERT/UPDATE/ALL. No se asume "ALL" para simplificar:
        // se deriva de policy.cmd tal cual lo reporta pg_policy.
        const needsQual =
          policy.cmd === "SELECT" ||
          policy.cmd === "UPDATE" ||
          policy.cmd === "DELETE" ||
          policy.cmd === "ALL";
        const needsWithCheck =
          policy.cmd === "INSERT" || policy.cmd === "UPDATE" || policy.cmd === "ALL";

        if (needsQual) {
          expect(
            isPermittedPolicyForm(policy.qual, "qual", policy.cmd, table),
            `${table}.${policy.policyname}: USING (${policy.cmd}) no coincide byte a byte con ninguna forma canónica permitida: "${policy.qual}"`,
          ).toBe(true);
        }
        if (needsWithCheck) {
          expect(
            isPermittedPolicyForm(policy.with_check, "with_check", policy.cmd, table),
            `${table}.${policy.policyname}: WITH CHECK (${policy.cmd}) no coincide byte a byte con ninguna forma canónica permitida: "${policy.with_check}"`,
          ).toBe(true);
        }
      }
    }
  });

  it("SELECT nunca devuelve filas de otro tenant y sí ve las propias", async () => {
    expect(tables.length, "no se descubrieron tablas con tenant_id").toBeGreaterThan(0);

    for (const table of tables) {
      // Para la mayoría de tablas esto es "tenant_id"; para `tenants` es "id" (ver
      // SCOPE_COLUMN). La fila "propia" de A se identifica por esta columna, no
      // asumiendo siempre `tenant_id`.
      const scopeColumn = scopeColumnFor(table);
      const { data, error } = await tenantA.client.from(table).select(scopeColumn);
      expect(error, `${table}: SELECT devolvió error inesperado`).toBeNull();

      // supabase-js no puede tipar el resultado de `.select()` con un nombre de columna
      // dinámico (no-literal): infiere un tipo de error genérico en vez de una fila real.
      // El `as unknown` intermedio es deliberado, no un `any` encubierto -- la forma real
      // en runtime (una fila con una única columna `scopeColumn`) ya se verifica más
      // abajo comparando sus valores, no aquí en el tipo.
      const rows = (data ?? []) as unknown as Record<string, string | null>[];

      const foreign = rows.filter((row) => {
        const value = row[scopeColumn];
        if (value === null) return !SHARED_READ_TABLES.has(table);
        return value !== tenantA.tenantId;
      });
      expect(foreign, `${table}: fuga de ${foreign.length} filas`).toHaveLength(0);

      // Control positivo: una policy deny-all (`using (false)`) también devolvería 0
      // filas para "foreign", pasando en falso. Probar que A además VE sus propias
      // filas descarta ese falso positivo.
      const own = rows.filter((row) => row[scopeColumn] === tenantA.tenantId);
      expect(
        own.length,
        `${table}: A no ve ninguna fila propia (control positivo ausente; ¿policy deny-all?)`,
      ).toBeGreaterThan(0);
    }
  });

  it("INSERT con el tenant_id de otro es rechazado por RLS", async () => {
    expect(tables.length, "no se descubrieron tablas con tenant_id").toBeGreaterThan(0);

    for (const table of tables) {
      const fixture = WRITE_FIXTURES[table];
      if (!fixture) {
        expect.fail(
          `Tabla '${table}' descubierta sin entrada en WRITE_FIXTURES: añade su payload de escritura antes de continuar.`,
        );
      }

      const payload = fixture.insertPayload({ tenantA, tenantB, seedB });
      const { error } = await tenantA.client.from(table).insert(payload);
      expect(error, `${table}: INSERT cross-tenant NO fue rechazado`).not.toBeNull();
      // No basta con "hubo un error": una violación NOT NULL también lo satisfaría.
      // Debe ser específicamente la guarda de aislamiento esperada para esta tabla
      // (RLS 42501, o el trigger assert_same_tenant para las tablas con FK a un padre
      // de otro tenant), no un fallo incidental.
      const expected = fixture.expectedInsertRejection;
      expect(
        error?.code,
        `${table}: INSERT cross-tenant fue rechazado por otra razón (${error?.message}), no por la guarda de aislamiento esperada (${expected.code})`,
      ).toBe(expected.code);
      if (expected.messageIncludes) {
        expect(
          error?.message,
          `${table}: el mensaje de error no confirma la guarda de aislamiento esperada`,
        ).toContain(expected.messageIncludes);
      }
    }
  });

  it("UPDATE sobre filas de otro tenant no afecta a ninguna fila", async () => {
    expect(tables.length, "no se descubrieron tablas con tenant_id").toBeGreaterThan(0);

    for (const table of tables) {
      const fixture = WRITE_FIXTURES[table];
      if (!fixture) {
        expect.fail(
          `Tabla '${table}' descubierta sin entrada en WRITE_FIXTURES: añade su columna/valor de UPDATE antes de continuar.`,
        );
      }
      const { updateColumn, updateValue } = fixture;
      const scopeColumn = scopeColumnFor(table);

      const { data, error } = await tenantA.client
        .from(table)
        .update({ [updateColumn]: updateValue })
        .eq(scopeColumn, tenantB.tenantId)
        .select();

      if (fixture.expectedUpdateRejection) {
        // Esta tabla revoca el privilegio UPDATE a `authenticated` a nivel de GRANT (ver
        // el comentario en su WRITE_FIXTURES): el rechazo esperado es un error explícito,
        // no una ausencia de filas afectadas.
        const expected = fixture.expectedUpdateRejection;
        expect(error, `${table}: UPDATE cross-tenant NO fue rechazado`).not.toBeNull();
        expect(
          error?.code,
          `${table}: UPDATE cross-tenant fue rechazado por otra razón (${error?.message}), no por la guarda esperada (${expected.code})`,
        ).toBe(expected.code);
        if (expected.messageIncludes) {
          expect(
            error?.message,
            `${table}: el mensaje de error no confirma la guarda esperada`,
          ).toContain(expected.messageIncludes);
        }
      } else {
        expect(error, `${table}: UPDATE cross-tenant devolvió error inesperado`).toBeNull();
        expect(data ?? [], `${table}: UPDATE cross-tenant afectó filas`).toHaveLength(0);
      }

      const { data: intact, error: intactError } = await admin
        .from(table)
        .select("*")
        .eq(scopeColumn, tenantB.tenantId);
      expect(intactError, `${table}: error verificando integridad tras UPDATE`).toBeNull();
      expect(
        (intact ?? []).length,
        `${table}: no había fila de B para probar el UPDATE cross-tenant (control positivo ausente)`,
      ).toBeGreaterThan(0);
      expect(
        (intact ?? []).every((row) => row[updateColumn] !== updateValue),
        `${table}: UPDATE cross-tenant modificó datos de B`,
      ).toBe(true);
    }
  });

  it("DELETE sobre filas de otro tenant no borra nada", async () => {
    expect(tables.length, "no se descubrieron tablas con tenant_id").toBeGreaterThan(0);

    for (const table of tables) {
      if (!WRITE_FIXTURES[table]) {
        expect.fail(`Tabla '${table}' descubierta sin entrada en WRITE_FIXTURES.`);
      }

      const scopeColumn = scopeColumnFor(table);

      const before = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(scopeColumn, tenantB.tenantId);
      expect(
        before.count ?? 0,
        `${table}: no había fila de B para probar el DELETE cross-tenant (control positivo ausente)`,
      ).toBeGreaterThan(0);

      await tenantA.client.from(table).delete().eq(scopeColumn, tenantB.tenantId);

      const after = await admin
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(scopeColumn, tenantB.tenantId);
      expect(after.count).toBe(before.count);
    }
  });
});
