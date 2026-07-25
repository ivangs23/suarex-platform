/**
 * REGLAS DE UN GRUPO DE OPCIONES: cuántas se pueden elegir y cuántas hay que elegir.
 *
 * Vive en el dominio, sin base de datos ni React, porque las TRES capas que lo necesitan tienen
 * que dar la misma respuesta: la ficha del producto (para habilitar "Añadir"), el carrito, y el
 * servidor al crear el pedido. Si cada una llevara su propia aritmética, el día que divergieran
 * la que manda sería la del servidor y el comensal se llevaría un rechazo después de haber
 * elegido -- o, peor, pasaría un pedido a cocina sin el punto de la carne.
 */
export type OptionGroup = {
  id: string;
  name: string;
  /** Cuántas hay que elegir como mínimo. `0` = grupo opcional. */
  minSelect: number;
  /** Cuántas se pueden elegir como máximo. Siempre `>= 1`. */
  maxSelect: number;
  /** Los ids de las opciones de ESTE grupo. */
  optionIds: string[];
};

export type OptionViolation = {
  groupId: string;
  groupName: string;
  /** `too-few` = faltan por elegir; `too-many` = se han elegido de más. */
  kind: "too-few" | "too-many";
  /** El límite incumplido (el mínimo en `too-few`, el máximo en `too-many`). */
  limit: number;
  /** Cuántas hay elegidas de ese grupo ahora mismo. */
  chosen: number;
};

/**
 * Qué reglas incumple una selección. Lista vacía = se puede añadir al pedido.
 *
 * Devuelve TODAS las violaciones, no la primera: quien monta un menú del día con tres grupos
 * merece ver de una vez qué le falta, no descubrirlo de uno en uno a base de intentos.
 *
 * Las opciones elegidas que no pertenecen a ningún grupo se ignoran aquí a propósito -- son los
 * añadidos sueltos de siempre, sin más regla que existir, y de que EXISTAN ya responde el
 * servidor al crear el pedido. Esta función solo responde de los grupos.
 */
export function validateOptionGroups(
  groups: OptionGroup[],
  selectedOptionIds: string[],
): OptionViolation[] {
  // Un id repetido es la misma elección real una sola vez -- igual que hace `createPendingOrder`
  // al cobrar. Sin deduplicar, marcar dos veces el mismo topping "cumpliría" un mínimo de dos.
  const elegidas = new Set(selectedOptionIds);
  const violaciones: OptionViolation[] = [];

  for (const group of groups) {
    const chosen = group.optionIds.reduce((n, id) => n + (elegidas.has(id) ? 1 : 0), 0);
    if (chosen < group.minSelect) {
      violaciones.push({
        groupId: group.id,
        groupName: group.name,
        kind: "too-few",
        limit: group.minSelect,
        chosen,
      });
    } else if (chosen > group.maxSelect) {
      violaciones.push({
        groupId: group.id,
        groupName: group.name,
        kind: "too-many",
        limit: group.maxSelect,
        chosen,
      });
    }
  }

  return violaciones;
}

/** Atajo para la ficha del producto, que solo necesita saber si el botón se habilita. */
export function isSelectionComplete(groups: OptionGroup[], selectedOptionIds: string[]): boolean {
  return validateOptionGroups(groups, selectedOptionIds).length === 0;
}
