/**
 * Comprobación de policies de RLS por ALLOWLIST DE FORMA CANÓNICA EXACTA. Sustituye a un
 * heurístico anterior (`hasGenuineTenantCheck`) que solo rechazaba `true` desnudo y luego
 * exigía que la expresión "contuviera" `current_tenant_id()` y `tenant_id` en cualquier
 * parte. Eso es defeatable: `(tenant_id = current_tenant_id()) OR true`,
 * `(tenant_id = current_tenant_id()) OR (1=1)` y `tenant_id = current_tenant_id() OR
 * tenant_id IS NOT NULL` contienen ambos tokens y son totalmente permisivas. En
 * `products`/`product_extras` esa comprobación de policy es la ÚNICA guarda del WITH CHECK
 * (el trigger BEFORE `assert_same_tenant` dispara P0001 antes de que la policy llegue a
 * evaluarse, ver `20260721000002_catalog.sql`), así que una sola cláusula OR de más reabre
 * el agujero de fuga cross-tenant que esta suite existe para cerrar.
 */

export type PolicyCmd = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'

export type PolicyRow = {
  schemaname: string
  tablename: string
  policyname: string
  cmd: PolicyCmd
  qual: string | null
  with_check: string | null
}

export type PolicyClause = 'qual' | 'with_check'

/**
 * Forma canónica estándar. Postgres renderiza las expresiones de policy de forma
 * determinista vía `pg_get_expr` (confirmado empíricamente contra la base local; ver
 * `.superpowers/sdd/task-4-report.md`, sección "Fix round 3", para la consulta exacta
 * usada y su salida byte a byte).
 */
const TENANT_SCOPED_FORM = '(tenant_id = current_tenant_id())'

/**
 * Excepción declarada única: `allergens_read` admite además las filas globales del catálogo
 * de la UE (`tenant_id IS NULL`). Su permiso está restringido ESTRUCTURALMENTE vía
 * `commands: ['SELECT']` más abajo, no por el nombre de la tabla: cualquier policy que
 * gobierne escrituras (`with_check`, o `qual`/`with_check` de una policy `FOR ALL`/`FOR
 * UPDATE`/`FOR INSERT`) queda fuera de `commands` y por tanto nunca puede aceptar esta
 * forma. `allergens_write` (`FOR ALL`) sigue exigiendo la forma estándar en ambas
 * cláusulas y falla si se degrada a esta excepción.
 */
const ALLERGENS_READ_EXCEPTION_FORM = '((tenant_id IS NULL) OR (tenant_id = current_tenant_id()))'

type PermittedForm = {
  expr: string
  clause: PolicyClause
  commands: readonly PolicyCmd[]
}

/**
 * Lista corta A PROPÓSITO. El punto de una allowlist es fallar cerrado: una policy
 * legítima nueva con una forma distinta a estas dos DEBE romper este test, y eso es
 * correcto -- fuerza una decisión deliberada de añadirla aquí en vez de dejar pasar en
 * silencio una expresión permisiva. Si este test falla por una policy nueva, la respuesta
 * es añadir su forma exacta (confirmada empíricamente contra la base, nunca adivinada) a
 * esta lista, con su restricción de `clause`/`commands` correspondiente -- NUNCA relajar
 * la comparación a un prefijo, un "contains" o un regex laxo. Eso reintroduciría
 * exactamente el defecto que esta ronda de fix cierra.
 */
const PERMITTED_FORMS: readonly PermittedForm[] = [
  {
    expr: TENANT_SCOPED_FORM,
    clause: 'qual',
    commands: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'],
  },
  {
    expr: TENANT_SCOPED_FORM,
    clause: 'with_check',
    commands: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'],
  },
  {
    expr: ALLERGENS_READ_EXCEPTION_FORM,
    clause: 'qual',
    commands: ['SELECT'],
  },
]

/** Normaliza SOLO espacios en blanco (colapsa runs, recorta extremos). Nunca quita
 * paréntesis, operadores ni cláusulas: la comparación final sigue siendo byte-a-byte
 * contra la forma canónica completa. */
function normalizeWhitespace(expr: string): string {
  return expr.trim().replace(/\s+/g, ' ')
}

/**
 * true únicamente si `expr`, tras normalizar espacios, es EXACTAMENTE IGUAL (no
 * subcadena, no prefijo, no regex) a una de las formas de `PERMITTED_FORMS` válidas para
 * esa combinación de cláusula (`qual`/`with_check`) y comando de policy (`cmd`).
 */
export function isPermittedPolicyForm(
  expr: string | null,
  clause: PolicyClause,
  cmd: PolicyCmd,
): boolean {
  if (!expr) return false
  const normalized = normalizeWhitespace(expr)
  return PERMITTED_FORMS.some(
    (form) => form.clause === clause && form.expr === normalized && form.commands.includes(cmd),
  )
}
