import { uploadProductImage } from "@suarex/db";
import { afterAll, describe, expect, it } from "vitest";
import { admin } from "./helpers/tenants.js";

// PNG 1x1 mínimo válido.
const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

// Únicos objetos que este fichero llega a subir de verdad (los tests de rechazo
// fallan la validación ANTES de tocar Storage, así que no dejan nada que limpiar).
// Se borran en `afterAll` para no dejar el bucket local creciendo sin límite entre
// ejecuciones repetidas de la suite.
const uploadedPaths: string[] = [];

afterAll(async () => {
  if (uploadedPaths.length === 0) return;
  const { error } = await admin.storage.from("catalog").remove(uploadedPaths);
  if (error) throw error;
});

describe("uploadProductImage", () => {
  it("sube un PNG y devuelve una ruta bajo el tenant", async () => {
    const tenantId = crypto.randomUUID();
    const path = await uploadProductImage(tenantId, { bytes: PNG_1x1, contentType: "image/png" });
    uploadedPaths.push(path);
    expect(path).toContain(`tenant/${tenantId}/products/`);

    // El objeto existe en el bucket.
    const { data } = await admin.storage.from("catalog").list(`tenant/${tenantId}/products`);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("rechaza un tipo no permitido", async () => {
    await expect(
      uploadProductImage(crypto.randomUUID(), { bytes: PNG_1x1, contentType: "application/pdf" }),
    ).rejects.toThrow(/tipo/i);
  });

  it("rechaza un fichero demasiado grande", async () => {
    // 16 MB: por encima del tope de ENTRADA (15 MB). Ese tope ya no acota lo que se
    // guarda -- de eso se encarga la optimización, que reescala a 900 px y WebP -- sino lo
    // que se descarga y se descomprime en memoria.
    const big = new Uint8Array(16 * 1024 * 1024);
    await expect(
      uploadProductImage(crypto.randomUUID(), { bytes: big, contentType: "image/png" }),
    ).rejects.toThrow(/tama/i);
  });

  // Defensa en profundidad: `uploadProductImage` interpola `tenantId` directamente en
  // una ruta de Storage (a diferencia de las funciones de `client.ts`, que lo atan a un
  // parámetro de RPC o a un `.eq('tenant_id', ...)`), así que valida por sí misma que
  // sea un UUID bien formado ANTES de construir esa ruta -- sin depender de que quien
  // llama nunca le pase un valor con `/` o `../`. Los tres casos de abajo deben
  // rechazarse por la validación de `tenantId`, no llegar nunca a tocar Storage: si
  // llegaran, `admin.storage...upload` fallaría por un path inválido con un error
  // distinto (no `/tenantId/i`), y además dejaría objetos huérfanos que este fichero no
  // sabría limpiar (no se registran en `uploadedPaths`).
  it("rechaza un tenantId con '../' antes de tocar Storage", async () => {
    await expect(
      uploadProductImage("../../etc", { bytes: PNG_1x1, contentType: "image/png" }),
    ).rejects.toThrow(/tenantId/i);
  });

  it("rechaza un tenantId con '/' antes de tocar Storage", async () => {
    await expect(
      uploadProductImage("otro-tenant/products", { bytes: PNG_1x1, contentType: "image/png" }),
    ).rejects.toThrow(/tenantId/i);
  });

  it("rechaza un tenantId que no es un UUID antes de tocar Storage", async () => {
    await expect(
      uploadProductImage("no-soy-un-uuid", { bytes: PNG_1x1, contentType: "image/png" }),
    ).rejects.toThrow(/tenantId/i);
  });
});
