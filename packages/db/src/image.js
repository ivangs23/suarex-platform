/**
 * OPTIMIZACIÓN DE IMÁGENES, ANTES DE GUARDARLAS.
 *
 * Por qué existe: el catálogo real de un cliente traía 89 MB de fotos -- 610 KB de media por
 * plato, con originales de hasta 2,3 MB y 6250 px de ancho -- para pintarlas en tarjetas de
 * 250 px. Una sola categoría eran ~8 MB. En la terraza, con datos móviles, eso pesa más en la
 * experiencia que cualquier detalle de diseño: la carta tarda en aparecer justo cuando el
 * comensal la abre.
 *
 * Se optimiza AL GUARDAR y no al servir: el bucket es público y las fotos se piden tal cual
 * desde la tarjeta (no pasan por el optimizador de Next, que necesitaría `remotePatterns` con
 * un host que cambia por despliegue). Guardar ya la versión buena es lo único que garantiza
 * que nadie descargue el original.
 *
 * SHARP SE CARGA BAJO DEMANDA, no con un `import` arriba. `proxy.ts` -- el middleware, que
 * corre en cada petición y en un runtime sin módulos nativos -- importa `@suarex/db`, y su
 * barril reexporta `storage.ts`, que importa este fichero. Con un import estático, sharp
 * entraba en el bundle del middleware y TODA la web devolvía 500 antes de llegar a ninguna
 * página. Dentro de la función, el módulo solo se carga cuando de verdad se va a optimizar
 * una imagen -- que es en el servidor, subiendo o migrando.
 *
 * ESTE FICHERO ES JAVASCRIPT A PROPÓSITO. Lo usan dos mundos: la app (TypeScript, camino del
 * panel de administración) y `scripts/import-catalog.mjs` (Node a pelo, camino de la
 * migración de un cliente). Si la política viviera en TypeScript, el script no podría
 * importarla y acabaríamos con dos copias que se separan en cuanto una cambie -- y la del
 * importador es justo la que trae los 89 MB.
 */

/**
 * Lado máximo de una foto de catálogo (producto o categoría).
 *
 * 900 px: las tarjetas miden ~250 px y la franja de la foto ~145 px, así que 900 cubre con
 * holgura una pantalla de densidad 3× sin pagar por píxeles que nadie ve.
 */
export const MAX_SIDE = 900;

/**
 * Lado máximo de una foto de MARCA (la de la pantalla de bienvenida). Va a sangre completa
 * detrás de todo, así que necesita más resolución que una tarjeta.
 */
export const MAX_SIDE_BRAND = 1600;

/** Calidad de WebP. 78 es donde deja de notarse la diferencia en una foto de comida. */
const QUALITY = 78;

/**
 * @typedef {object} ImagenOptimizada
 * @property {Uint8Array} bytes
 * @property {string} contentType
 * @property {string} ext
 * @property {number} originalBytes
 */

/**
 * Reescala si hace falta y reconvierte a WebP.
 *
 * - `fit: "inside"` + `withoutEnlargement`: respeta la proporción y NUNCA agranda. Una foto
 *   que ya es pequeña se queda como está: estirarla solo añadiría peso y la vería borrosa.
 * - `rotate()` sin argumentos aplica la orientación EXIF. Sin esto, una foto hecha con el
 *   móvil de lado sale girada en la carta -- y al reescalar se pierde ese metadato, así que
 *   hay que resolverlo aquí o no se resuelve nunca.
 * - Salida siempre WebP: pesa bastante menos que JPEG/PNG a igualdad de calidad y lo entiende
 *   cualquier navegador que pueda con esta carta.
 *
 * Si los bytes no son una imagen que sharp entienda, LANZA. Es deliberado: guardar el fichero
 * original "por si acaso" es exactamente cómo se llega a un bucket con 89 MB de fotos que
 * nadie mira.
 *
 * @param {Uint8Array} bytes
 * @param {{ maxSide?: number }} [opciones]
 * @returns {Promise<ImagenOptimizada>}
 */
export async function optimizeImage(bytes, opciones = {}) {
  const maxSide = opciones.maxSide ?? MAX_SIDE;

  const { default: sharp } = await import("sharp");

  const salida = await sharp(bytes)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();

  return {
    bytes: new Uint8Array(salida),
    contentType: "image/webp",
    ext: "webp",
    originalBytes: bytes.byteLength,
  };
}
