/**
 * Fix round 2 (Finding 3): `requiredString`/`optionalString`/`parseOptionalInt`/
 * `parseOptionalBoolean` estaban re-declaradas, idénticas, en `app/admin/catalogo/actions.ts`,
 * `app/admin/mesas/actions.ts` y `app/admin/dispositivos/actions.ts` -- y Task 4 (impresoras)
 * y la fase D3 (personal) iban a volver a copiarlas. Se consolidan aquí; toda Server Action
 * de `app/admin/**` debe importarlas de este módulo en vez de redeclararlas.
 *
 * Ninguna de estas cuatro funciones es específica de un dominio (catálogo/mesas/
 * dispositivos): no saben qué es un `venue_id` o un `ttl_minutes`, solo saben leer un campo
 * de un `FormData` y convertirlo a un tipo primitivo. La validación de reglas de negocio
 * (un precio no puede ser negativo, un `ttl_minutes` no puede superar 24h...) sigue viviendo
 * en el módulo del dominio correspondiente (`catalog-action-input.ts`,
 * `device-action-input.ts`) o en el repositorio de `@suarex/db`, construida ENCIMA de estos
 * parsers genéricos, nunca duplicándolos.
 */
export class InvalidFormFieldError extends Error {}

/** Campo obligatorio: ausente o vacío (tras `trim()`) lanza. */
export function requiredString(formData: FormData, field: string): string {
  const value = String(formData.get(field) ?? "").trim();
  if (!value) throw new InvalidFormFieldError(`Falta el campo obligatorio: ${field}`);
  return value;
}

/** Campo opcional: ausente o vacío (tras `trim()`) devuelve `undefined`, nunca `""`. */
export function optionalString(formData: FormData, field: string): string | undefined {
  const raw = formData.get(field);
  if (raw === null) return undefined;
  const value = String(raw).trim();
  return value === "" ? undefined : value;
}

/**
 * Fix round 2 (Finding 3, minor de Task 2): antes `Number(optionalString(...))` sin más
 * comprobación -- un `sort_order` mal formado ("abc") producía `NaN`, que llegaba tal cual
 * al repositorio (`updateTable`/`createTable`) y de ahí a una columna `integer` de Postgres.
 * Se rechaza aquí con un error claro en vez de dejar que `NaN` viaje más allá de este parser
 * hacia una capa que no lo espera.
 */
export function parseOptionalInt(formData: FormData, field: string): number | undefined {
  const raw = optionalString(formData, field);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new InvalidFormFieldError(
      `${field} inválido (se esperaba un número): ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

/**
 * Deliberadamente permisivo, IGUAL que la implementación original de
 * `app/admin/mesas/actions.ts`: solo la cadena exacta `"true"` produce `true`; cualquier otro
 * valor no vacío (`"false"`, un typo, `"1"`...) produce `false`, no lanza. Si un futuro campo
 * necesita rechazar valores que no sean exactamente `"true"`/`"false"` (en vez de tratarlos
 * en silencio como `false`), usa `parseAvailability` de `catalog-action-input.ts` como
 * plantilla para un parser estricto específico de ese dominio -- no endurezcas este, que
 * comparten mesas/dispositivos/catálogo y cuyo contrato actual ya se usa a propósito.
 */
export function parseOptionalBoolean(formData: FormData, field: string): boolean | undefined {
  const raw = optionalString(formData, field);
  return raw === undefined ? undefined : raw === "true";
}
