/**
 * Reexporta la subida de imágenes de producto desde `@suarex/db`: la lógica (validación
 * de tipo/tamaño, ruta tenant-scoped, subida con service role) vive ahí porque solo
 * `packages/db` puede importar `@supabase/supabase-js` (ver `biome.json`,
 * `noRestrictedImports`). Este fichero es el único punto de `apps/web` que consume esa
 * subida -- ningún formulario de producto la usa todavía (eso es tarea 4/5).
 */
export { uploadProductImage } from "@suarex/db";
