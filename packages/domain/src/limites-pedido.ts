/**
 * Límites de un pedido. Una sola verdad para los tres que los aplican: el borde de las rutas
 * API (zod, `apps/web/lib/api-input.ts`), `createPendingOrder` (`@suarex/db`) y el carrito, que
 * no deja pasar de ahí para que el comensal nunca reciba un rechazo que no entiende.
 */

/** Líneas por pedido. Una mesa no pide cien platos distintos; más es un abuso del endpoint. */
export const MAX_LINEAS_PEDIDO = 100;

/** Unidades por línea. */
export const MAX_CANTIDAD_LINEA = 99;

/** Extras por línea. */
export const MAX_EXTRAS_LINEA = 20;

/** Caracteres de la nota de una línea: el mismo `maxLength` que el campo de la ficha. */
export const MAX_NOTAS_LINEA = 280;
