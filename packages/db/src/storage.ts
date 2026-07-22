import { storageServiceClient } from "./client.js";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Sube una imagen de producto al bucket `catalog` bajo `tenant/{tenantId}/products/`,
 * siempre por el servidor con service role -- el navegador nunca escribe directamente
 * en Storage (ver `supabase/migrations/20260722000007_catalog_storage.sql`: el bucket
 * es público en lectura pero sin policies de INSERT/UPDATE/DELETE para
 * anon/authenticated). Valida tipo y tamaño ANTES de intentar la subida, para no
 * gastar una llamada de red con un fichero que se va a rechazar igualmente.
 */
export async function uploadProductImage(
  tenantId: string,
  file: { bytes: Uint8Array; contentType: string },
): Promise<string> {
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

  const { error } = await storageServiceClient()
    .from("catalog")
    .upload(path, file.bytes, { contentType: file.contentType, upsert: false });
  if (error) throw error;

  return path;
}
