/** Lanzado por los parsers de este módulo -- nunca llega a tocar la base de datos. */
export class InvalidCatalogActionInputError extends Error {}

/**
 * Fix round 1 (Finding 2): `allergen_id` identifica una fila de `allergens.id`
 * (`bigserial`, ver `20260721000002_catalog.sql`) -- un entero positivo. Antes,
 * `deleteTenantAllergenAction` (`app/admin/catalogo/actions.ts`) hacía
 * `Number(requiredString(formData, "allergen_id"))` sin más comprobación: un valor no
 * numérico ("abc") produce `NaN`, y `.eq("id", NaN)` no es un error de PostgREST -- es un
 * filtro que simplemente no encuentra ninguna fila, así que `deleteTenantAllergen`
 * termina sin lanzar y sin haber borrado nada, dando una falsa sensación de éxito en vez
 * de un rechazo claro. Se valida aquí con la misma disciplina que `parseAllergenIds` de
 * ese fichero (`Number.isInteger`), más el límite adicional de que un id no puede ser
 * cero ni negativo (ningún `bigserial` empieza en 0 o por debajo).
 */
export function parseAllergenId(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidCatalogActionInputError(
      `allergen_id inválido (se esperaba un entero positivo): ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

/**
 * Fix round 1 (Finding 2): `setProductAvailabilityAction` hacía
 * `requiredString(formData, "is_available") === "true"`, que trata CUALQUIER valor que no
 * sea exactamente "true" -- un typo, "1", "yes", o un string vacío -- como `false` en
 * silencio. Un formulario mal formado, o un caller que invoque la action directamente con
 * un valor inesperado, no debe desactivar un producto por accidente: se rechaza aquí
 * cualquier valor que no sea exactamente "true" o "false".
 */
export function parseAvailability(raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new InvalidCatalogActionInputError(
    `is_available inválido (se esperaba "true" o "false"): ${JSON.stringify(raw)}`,
  );
}
