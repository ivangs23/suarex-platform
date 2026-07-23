/** Pareja mínima para razonar sobre el árbol: cada categoría y quién es su padre. */
export type CategoryParent = { id: string; parentId: string | null };

/**
 * ¿Mover `categoryId` bajo `newParentId` crearía un ciclo?
 *
 * `categories.parent_id` es una clave ajena a la PROPIA tabla, así que Postgres acepta
 * encantado `a → b → a`. Un ciclo no da error: deja una rama del catálogo inalcanzable
 * desde la raíz -- sus productos desaparecen de la carta sin que nadie los haya borrado --
 * y hace que cualquier recorrido ingenuo del árbol se cuelgue. Las lecturas ya degradan
 * ante un ciclo (`buildMenuView`, `buildCatalogView`), pero eso es la red de seguridad;
 * esto es lo que impide crearlo.
 *
 * Tres formas de crearlo, todas cubiertas aquí:
 *   - ser padre de sí misma
 *   - colgarse de uno de sus propios descendientes
 *   - colgarse de una rama que YA tuviera un ciclo (se corta con `seen`)
 *
 * Función pura: recibe el árbol ya leído, no consulta nada.
 */
export function wouldCreateCycle(
  categories: CategoryParent[],
  categoryId: string,
  newParentId: string | null,
): boolean {
  // Pasar a raíz nunca puede cerrar un ciclo: se deja de colgar de nadie.
  if (newParentId === null) return false;
  if (newParentId === categoryId) return true;

  const padreDe = new Map(categories.map((c) => [c.id, c.parentId]));

  // Se sube desde el padre PROPUESTO hacia la raíz: si por el camino aparece la categoría
  // que se está moviendo, es que el destino cuelga de ella y el movimiento la metería
  // dentro de sí misma.
  const seen = new Set<string>();
  let actual: string | null = newParentId;
  while (actual !== null && !seen.has(actual)) {
    if (actual === categoryId) return true;
    seen.add(actual);
    actual = padreDe.get(actual) ?? null;
  }

  // Se salió del bucle por `seen`: la rama de destino ya tenía un ciclo previo. Colgar algo
  // de ahí lo dejaría igual de inalcanzable, así que se rechaza también.
  return actual !== null;
}
