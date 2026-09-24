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

/** Franja horaria de una categoría, ya validada. `null` en ambas = se ofrece siempre. */
export type FranjaHoraria = { visibleDesde: string | null; visibleHasta: string | null };

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Las dos horas de la franja de carta (`<input type="time">`, que manda `"HH:MM"`).
 *
 * Devuelve `undefined` si el formulario no trae los campos -- eso es "no toques la franja",
 * distinto de `{null, null}`, que es "quítala". Sin esa distinción, cualquier otro formulario
 * que edite la categoría borraría la franja sin mencionarlo.
 *
 * Rechaza la media franja y la franja vacía en vez de dejar que reviente el CHECK de la base
 * (`categories_franja_completa` / `categories_franja_no_vacia`): el error de Postgres llega
 * como un 500 sin texto útil, y quien gestiona la carta se queda sin saber qué ha hecho mal.
 */
export function parseFranja(formData: FormData): FranjaHoraria | undefined {
  const bruto = (campo: string): string | null => {
    const raw = formData.get(campo);
    return raw === null ? null : String(raw).trim();
  };

  const desde = bruto("visible_desde");
  const hasta = bruto("visible_hasta");
  if (desde === null && hasta === null) return undefined;

  if (!desde && !hasta) return { visibleDesde: null, visibleHasta: null };

  if (!desde || !hasta) {
    throw new InvalidCatalogActionInputError(
      "Para limitar la franja horaria hacen falta las dos horas: desde y hasta. Déjalas en blanco las dos para que la categoría se ofrezca siempre.",
    );
  }
  for (const [campo, valor] of [
    ["visible_desde", desde],
    ["visible_hasta", hasta],
  ] as const) {
    if (!HORA.test(valor)) {
      throw new InvalidCatalogActionInputError(
        `${campo} inválido (se esperaba HH:MM): ${JSON.stringify(valor)}`,
      );
    }
  }
  if (desde === hasta) {
    throw new InvalidCatalogActionInputError(
      "La hora de inicio y la de fin no pueden ser la misma. Déjalas en blanco las dos para que la categoría se ofrezca siempre.",
    );
  }

  return { visibleDesde: desde, visibleHasta: hasta };
}
