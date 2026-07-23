/**
 * Declaraciones de `image.js`.
 *
 * Existen porque ese módulo es JavaScript a propósito (lo comparten la app y el importador,
 * ver su docstring) y los paquetes que consumen `@suarex/db` no habilitan `allowJs`: sin este
 * fichero, `storage.ts` importaría un `any` y se perdería la comprobación de tipos en el
 * único sitio donde importa -- lo que se guarda en Storage.
 */

export declare const MAX_SIDE: number;
export declare const MAX_SIDE_BRAND: number;

export type ImagenOptimizada = {
  bytes: Uint8Array;
  /** Siempre `image/webp`. */
  contentType: string;
  /** Siempre `webp`. */
  ext: string;
  /** Tamaño del original, para poder informar de lo que se ha ahorrado. */
  originalBytes: number;
};

/**
 * Reescala (sin agrandar nunca) al lado máximo indicado y reconvierte a WebP.
 * Lanza si los bytes no son una imagen reconocible.
 */
export declare function optimizeImage(
  bytes: Uint8Array,
  opciones?: { maxSide?: number },
): Promise<ImagenOptimizada>;
