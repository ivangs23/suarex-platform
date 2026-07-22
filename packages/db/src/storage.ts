import { catalogBucket } from "./client.js";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

/** No hay validador de UUID compartido en el resto del paquete (las funciones
 * `tenantScoped`/RPC-bound de `client.ts` confían en que postgrest/la función SQL
 * rechace un valor mal formado): se define aquí, propio de este módulo. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sube una imagen de producto al bucket `catalog` bajo `tenant/{tenantId}/products/`,
 * siempre por el servidor con service role -- el navegador nunca escribe directamente
 * en Storage (ver `supabase/migrations/20260722000007_catalog_storage.sql`: el bucket
 * es público en lectura pero sin policies de INSERT/UPDATE/DELETE para
 * anon/authenticated). Valida `tenantId`, tipo y tamaño ANTES de construir la ruta o
 * intentar la subida, para no gastar una llamada de red con un fichero que se va a
 * rechazar igualmente.
 *
 * A diferencia de las funciones de `client.ts` (que atan el `tenantId` a un parámetro
 * de RPC o a un `.eq('tenant_id', ...)` de postgrest), esta función interpola
 * `tenantId` directamente en una ruta de Storage -- de ahí que valide aquí mismo que
 * sea un UUID bien formado antes de construir esa ruta, en vez de confiar en que quien
 * llama (hoy, solo `session.tenantId` ya autenticado) nunca le pase un valor con `/` o
 * `../`. `contentType` en cambio SÍ sigue viniendo tal cual del llamante, sin
 * verificarlo contra los bytes reales del fichero (no hay sniffing de magic bytes):
 * es seguro en este punto porque el servidor es el único llamante de esta función y el
 * bucket no tiene ninguna otra vía de escritura, pero no es una garantía que esta
 * función imponga por sí misma como sí hace ahora con `tenantId`.
 */
export async function uploadProductImage(
  tenantId: string,
  file: { bytes: Uint8Array; contentType: string },
): Promise<string> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`tenantId inválido: se esperaba un UUID, se recibió "${tenantId}"`);
  }
  if (!ALLOWED_TYPES.has(file.contentType)) {
    throw new Error(`Tipo de imagen no permitido: ${file.contentType}`);
  }
  if (file.bytes.byteLength > MAX_BYTES) {
    throw new Error(
      `Tamaño de imagen no permitido: ${file.bytes.byteLength} bytes (máx ${MAX_BYTES})`,
    );
  }

  const ext =
    file.contentType === "image/png" ? "png" : file.contentType === "image/webp" ? "webp" : "jpg";
  const path = `tenant/${tenantId}/products/${crypto.randomUUID()}.${ext}`;

  const { error } = await catalogBucket().upload(path, file.bytes, {
    contentType: file.contentType,
    upsert: false,
  });
  if (error) throw error;

  return path;
}
