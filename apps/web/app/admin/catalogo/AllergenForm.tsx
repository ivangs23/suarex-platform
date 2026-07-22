import { createTenantAllergenAction } from "./actions";

/**
 * Alta de alérgeno PROPIO del tenant. Mismo patrón que `CategoryForm`/`ExtraForm`:
 * formulario de servidor puro. Crea solo alérgenos del tenant -- nunca de los 14
 * globales de la UE, que son de solo lectura para cualquier tenant (ver
 * `createTenantAllergen` en `packages/db/src/admin-catalog.ts` y la policy
 * `allergens_write` en `20260721000002_catalog.sql`).
 */
export function AllergenForm() {
  return (
    <form action={createTenantAllergenAction}>
      <h3>Nuevo alérgeno propio</h3>

      <label htmlFor="allergen-name">Nombre del alérgeno</label>
      <input id="allergen-name" name="name_es" type="text" required />

      <label htmlFor="allergen-icon">Icono</label>
      <input id="allergen-icon" name="icon" type="text" />

      <button type="submit">Crear alérgeno</button>
    </form>
  );
}
