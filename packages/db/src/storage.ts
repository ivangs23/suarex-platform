import { catalogBucket } from "./client.js";
import { MAX_SIDE_BRAND, optimizeImage } from "./image.js";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Tope de lo que se ACEPTA, no de lo que se guarda.
 *
 * Eran 5 MB, y con eso una foto normal hecha con un móvil moderno se rechazaba de plano --
 * justo la vía por la que un gestor sube la foto de un plato. Ya no hace falta ser tan
 * estricto: lo que acaba en Storage lo decide `optimizeImage` (900 px de lado, WebP), así que
 * el peso guardado no depende de lo que entre. El límite sigue existiendo para acotar lo que
 * se descarga y se descomprime en memoria, no para acotar el bucket.
 */
const MAX_BYTES = 15 * 1024 * 1024;

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

  // Se guarda la versión optimizada, NUNCA el original: la foto que sube un gestor desde su
  // móvil son 3 MB y 4000 px para una tarjeta de 250. Ver `image.js`.
  const optimizada = await optimizeImage(file.bytes);

  const path = `tenant/${tenantId}/products/${crypto.randomUUID()}.${optimizada.ext}`;

  const { error } = await catalogBucket().upload(path, optimizada.bytes, {
    contentType: optimizada.contentType,
    upsert: false,
  });
  if (error) throw error;

  return path;
}

/**
 * Sube una imagen de marca al bucket `catalog` bajo `tenant/{tenantId}/branding/`, siempre
 * por el servidor con service role -- mismo bucket, mismas garantías y misma validación que
 * `uploadProductImage` (UUID de tenant, tipo, tamaño validados ANTES de construir la ruta o
 * tocar Storage).
 *
 * Sirve para las DOS imágenes de marca -- el logo y la foto de la pantalla de bienvenida
 * (`heroUrl`) --, que se validan y se guardan exactamente igual: una función por campo solo
 * duplicaría los límites de tipo y tamaño, con el riesgo de que uno se quedara atrás.
 *
 * A DIFERENCIA de `uploadProductImage`, devuelve la URL pública ABSOLUTA, no
 * la ruta: las imágenes de marca (ver `@suarex/config`, `safeParseImageUrl`) solo admiten URLs
 * absolutas http/https, así que quien consume el logo (el layout público) necesita la URL
 * ya resuelta, no una ruta relativa que tendría que recomponer. Se compone igual que
 * `catalogImageUrl` en `apps/web/app/admin/catalogo/page.tsx`: `${SUPABASE_URL}` +
 * el prefijo público del bucket.
 */
export async function uploadBrandingImage(
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

  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) throw new Error("SUPABASE_URL es obligatoria para componer la URL del logo");

  // La foto de bienvenida va a sangre completa detrás de todo, así que se le deja más lado
  // que a una tarjeta -- pero tampoco los 6000 px del original.
  const optimizada = await optimizeImage(file.bytes, { maxSide: MAX_SIDE_BRAND });

  const path = `tenant/${tenantId}/branding/${crypto.randomUUID()}.${optimizada.ext}`;

  const { error } = await catalogBucket().upload(path, optimizada.bytes, {
    contentType: optimizada.contentType,
    upsert: false,
  });
  if (error) throw error;

  return `${supabaseUrl}/storage/v1/object/public/catalog/${path}`;
}

/**
 * Borra una imagen de producto del bucket `catalog`.
 *
 * Sin esto, quitar la foto de un producto dejaría el objeto huérfano en Storage para
 * siempre: nadie lo referencia, nadie lo ve y nadie lo borra nunca. Con un cliente que
 * corrija fotos a menudo, el bucket crece sin techo y sin forma de saber qué sobra.
 *
 * La ruta DEBE colgar de `tenant/{tenantId}/`, y se comprueba aquí. Es la única defensa
 * real: `catalogBucket()` usa service role, así que un `path` manipulado que apuntara a
 * otro prefijo borraría la imagen de OTRO cliente. Quien llama pasa el `tenantId` de la
 * sesión, nunca uno del formulario.
 *
 * Un objeto que ya no está no es un error: el fin es que deje de existir, y si otra
 * ejecución se adelantó, el resultado es el mismo.
 */
export async function removeProductImage(tenantId: string, path: string): Promise<void> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`tenantId inválido: se esperaba un UUID, se recibió "${tenantId}"`);
  }

  const prefijo = `tenant/${tenantId}/`;
  if (!path.startsWith(prefijo)) {
    throw new Error("La imagen no pertenece a este cliente: se rechaza el borrado.");
  }

  const { error } = await catalogBucket().remove([path]);
  if (error) throw error;
}
