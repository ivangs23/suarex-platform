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

export type PolicyCmd = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";

export type PolicyRow = {
  schemaname: string;
  tablename: string;
  policyname: string;
  cmd: PolicyCmd;
  qual: string | null;
  with_check: string | null;
};

export type PolicyClause = "qual" | "with_check";

/**
 * Forma canónica estándar. Postgres renderiza las expresiones de policy de forma
 * determinista vía `pg_get_expr` (confirmado empíricamente contra la base local; ver
 * `.superpowers/sdd/task-4-report.md`, sección "Fix round 3", para la consulta exacta
 * usada y su salida byte a byte).
 */
const TENANT_SCOPED_FORM = "(tenant_id = current_tenant_id())";

/**
 * Excepción declarada única: `allergens_read` admite además las filas globales del catálogo
 * de la UE (`tenant_id IS NULL`). Su permiso está restringido ESTRUCTURALMENTE vía
 * `commands: ['SELECT']` más abajo, no por el nombre de la tabla: cualquier policy que
 * gobierne escrituras (`with_check`, o `qual`/`with_check` de una policy `FOR ALL`/`FOR
 * UPDATE`/`FOR INSERT`) queda fuera de `commands` y por tanto nunca puede aceptar esta
 * forma. `allergens_write` (`FOR ALL`) sigue exigiendo la forma estándar en ambas
 * cláusulas y falla si se degrada a esta excepción.
 */
const ALLERGENS_READ_EXCEPTION_FORM = "((tenant_id IS NULL) OR (tenant_id = current_tenant_id()))";

/**
 * Segunda excepción declarada: `public.tenants` no lleva columna `tenant_id` -- su
 * propia `id` ES el identificador de tenant -- así que su policy usa `id =
 * current_tenant_id()` en vez de `tenant_id = current_tenant_id()`. Permitida
 * ÚNICAMENTE para `tablename = 'tenants'` (ver `tables` en `PermittedForm` y su uso en
 * `isPermittedPolicyForm`): ninguna otra tabla puede colarse con una policy con ámbito
 * por `id` a través de esta forma.
 */
const SELF_SCOPED_FORM = "(id = current_tenant_id())";

/**
 * Hardening de dispositivos (device RLS, ver
 * `20260722000005_device_rls_hardening.sql`): forma que EXCLUYE al rol `device` de una
 * cláusula, dejando intacto el resto de roles (`current_tenant_role() IS DISTINCT FROM
 * 'device'` es `true` para cualquier valor que no sea exactamente 'device', incluido
 * NULL -- una sesión sin ese claim todavía). Usada tanto para tablas donde device pierde
 * TODO acceso (se añade a qual y with_check de la policy `for all` existente) como para
 * el lado de ESCRITURA de tablas donde device conserva lectura (INSERT/UPDATE/DELETE
 * separados del SELECT sin cambios). Forma confirmada empíricamente contra la base local
 * (`pg_get_expr` sobre una policy de prueba con exactamente esta expresión) -- no
 * adivinada.
 */
const ROLE_EXCLUDED_FORM =
  "((tenant_id = current_tenant_id()) AND (current_tenant_role() IS DISTINCT FROM 'device'::text))";

/**
 * Análoga a `ROLE_EXCLUDED_FORM` pero para `tenants`, que se aísla por su propia `id` en
 * vez de por `tenant_id` (mismo motivo que `SELF_SCOPED_FORM`). Restringida
 * ESTRUCTURALMENTE a `tablename = 'tenants'` vía `tables`, igual que `SELF_SCOPED_FORM`.
 */
const SELF_SCOPED_ROLE_EXCLUDED_FORM =
  "((id = current_tenant_id()) AND (current_tenant_role() IS DISTINCT FROM 'device'::text))";

/**
 * Excepción declarada de `allergens_read`, ahora con la exclusión de rol añadida: un
 * device no tiene ningún motivo para leer alérgenos (ni los propios de su tenant ni los
 * 14 globales de la UE con `tenant_id IS NULL`) -- construye el ticket a partir de los
 * snapshots ya desnormalizados en `order_items`/`order_item_extras`, nunca del catálogo.
 * Restringida a `tablename = 'allergens'` (a diferencia de `ALLERGENS_READ_EXCEPTION_FORM`,
 * que no lleva esa restricción): esta variante es nueva y solo la usa esa tabla, así que
 * se ata explícitamente en vez de dejarla disponible en general.
 */
const ALLERGENS_READ_DEVICE_EXCLUDED_FORM =
  "(((tenant_id IS NULL) OR (tenant_id = current_tenant_id())) AND (current_tenant_role() IS DISTINCT FROM 'device'::text))";

/**
 * Forma exclusiva de `devices_select_own`: un device solo ve SU PROPIA fila en
 * `devices` (identificada por `auth_user_id = auth.uid()`), nunca las de otros
 * dispositivos del mismo tenant -- el resto de roles siguen viendo todas las filas del
 * tenant vía la policy `devices_select_tenant` (que usa `ROLE_EXCLUDED_FORM` sin más).
 * Restringida ESTRUCTURALMENTE a `tablename = 'devices'` y `commands: ['SELECT']`: esta
 * forma nunca debe poder colarse como policy de escritura ni en ninguna otra tabla.
 */
const DEVICE_SELF_ROW_FORM =
  "((tenant_id = current_tenant_id()) AND (current_tenant_role() = 'device'::text) AND (auth_user_id = auth.uid()))";

/**
 * Segunda ronda de RLS por rol, esta vez para los roles humanos (D1 tarea 1, ver
 * `20260722000006_role_write_policies.sql`): forma de la policy de ESCRITURA de las
 * tablas de configuración (`categories`, `products`, `product_extras`, `allergens`,
 * `tables`, `venues`, `tenant_settings`), que pasa de `for all` sin dimensión de rol a
 * exigir `owner` o `admin`. `staff` (y también `device`, que tampoco es owner/admin)
 * quedan fuera. Confirmada empíricamente contra la base local: idéntica byte a byte en
 * las siete tablas (una sola entrada de allowlist, no una por tabla, tal como predecía
 * el brief) -- consultado con
 *   select tablename, policyname, qual, with_check from pg_policies
 *   where tablename in ('categories','products','product_extras','allergens','tables','venues','tenant_settings');
 * El SELECT de estas mismas tablas NO usa esta forma: se recreó reutilizando
 * exactamente `ROLE_EXCLUDED_FORM` (categories/products/product_extras/tables/venues)
 * o `ALLERGENS_READ_DEVICE_EXCLUDED_FORM` (allergens) ya existentes en este allowlist --
 * preserva la exclusión de `device` de 000005 en vez de reabrirla, así que no hace
 * falta ninguna entrada nueva para esos SELECT.
 *
 * D2 tarea 1 (ver `20260722000008_device_printer_role_writes.sql`) reutiliza esta MISMA
 * forma para `devices_write`/`printers_write` (`devices_insert`/`_update`/`_delete` y
 * `printers_insert`/`_update`/`_delete` de 000005, que solo excluían a `device`, pasan a
 * exigir owner/admin). Confirmado byte a byte contra la base local con
 *   select tablename, policyname, cmd, qual, with_check from pg_policies
 *   where tablename in ('devices','printers');
 * así que `devices`/`printers` se AÑADEN al conjunto de tablas de esta misma entrada en
 * vez de crear una entrada nueva. El SELECT de ambas tablas NO se toca: `printers_select`
 * sigue siendo `TENANT_SCOPED_FORM` (ya permitida sin restricción de tabla) y
 * `devices_select_tenant`/`devices_select_own` siguen usando `ROLE_EXCLUDED_FORM` y
 * `DEVICE_SELF_ROW_FORM` respectivamente (ambas ya en este allowlist) -- ninguna entrada
 * nueva hace falta para esos SELECT tampoco.
 */
const OWNER_ADMIN_WRITE_FORM =
  "((tenant_id = current_tenant_id()) AND (current_tenant_role() = ANY (ARRAY['owner'::text, 'admin'::text])))";

type PermittedForm = {
  expr: string;
  clause: PolicyClause;
  commands: readonly PolicyCmd[];
  /** Si se define, la forma solo se permite para estas tablas (comparación exacta de nombre). */
  tables?: ReadonlySet<string>;
};

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
    clause: "qual",
    commands: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"],
  },
  {
    expr: TENANT_SCOPED_FORM,
    clause: "with_check",
    commands: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"],
  },
  {
    expr: ALLERGENS_READ_EXCEPTION_FORM,
    clause: "qual",
    commands: ["SELECT"],
  },
  {
    expr: SELF_SCOPED_FORM,
    clause: "qual",
    commands: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"],
    tables: new Set(["tenants"]),
  },
  {
    expr: SELF_SCOPED_FORM,
    clause: "with_check",
    commands: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"],
    tables: new Set(["tenants"]),
  },
  {
    expr: ROLE_EXCLUDED_FORM,
    clause: "qual",
    commands: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"],
  },
  {
    expr: ROLE_EXCLUDED_FORM,
    clause: "with_check",
    commands: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"],
  },
  {
    expr: SELF_SCOPED_ROLE_EXCLUDED_FORM,
    clause: "qual",
    commands: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"],
    tables: new Set(["tenants"]),
  },
  {
    expr: SELF_SCOPED_ROLE_EXCLUDED_FORM,
    clause: "with_check",
    commands: ["SELECT", "INSERT", "UPDATE", "DELETE", "ALL"],
    tables: new Set(["tenants"]),
  },
  {
    expr: ALLERGENS_READ_DEVICE_EXCLUDED_FORM,
    clause: "qual",
    commands: ["SELECT"],
    tables: new Set(["allergens"]),
  },
  {
    expr: DEVICE_SELF_ROW_FORM,
    clause: "qual",
    commands: ["SELECT"],
    tables: new Set(["devices"]),
  },
  {
    expr: OWNER_ADMIN_WRITE_FORM,
    clause: "qual",
    commands: ["ALL"],
    tables: new Set([
      "categories",
      "products",
      "product_extras",
      "allergens",
      "tables",
      "venues",
      "tenant_settings",
      "devices",
      "printers",
      "tenant_payment_config",
    ]),
  },
  {
    expr: OWNER_ADMIN_WRITE_FORM,
    clause: "with_check",
    commands: ["ALL"],
    tables: new Set([
      "categories",
      "products",
      "product_extras",
      "allergens",
      "tables",
      "venues",
      "tenant_settings",
      "devices",
      "printers",
      "tenant_payment_config",
    ]),
  },
];

/** Normaliza SOLO espacios en blanco (colapsa runs, recorta extremos). Nunca quita
 * paréntesis, operadores ni cláusulas: la comparación final sigue siendo byte-a-byte
 * contra la forma canónica completa. */
function normalizeWhitespace(expr: string): string {
  return expr.trim().replace(/\s+/g, " ");
}

/**
 * true únicamente si `expr`, tras normalizar espacios, es EXACTAMENTE IGUAL (no
 * subcadena, no prefijo, no regex) a una de las formas de `PERMITTED_FORMS` válidas para
 * esa combinación de cláusula (`qual`/`with_check`), comando de policy (`cmd`) y tabla
 * (`tablename`) -- una forma con `tables` declarado (hoy solo `SELF_SCOPED_FORM`) exige
 * además que `tablename` esté en ese conjunto, para que ninguna otra tabla pueda adoptar
 * un ámbito por `id` en vez de por `tenant_id`.
 */
export function isPermittedPolicyForm(
  expr: string | null,
  clause: PolicyClause,
  cmd: PolicyCmd,
  tablename: string,
): boolean {
  if (!expr) return false;
  const normalized = normalizeWhitespace(expr);
  return PERMITTED_FORMS.some(
    (form) =>
      form.clause === clause &&
      form.expr === normalized &&
      form.commands.includes(cmd) &&
      (!form.tables || form.tables.has(tablename)),
  );
}
