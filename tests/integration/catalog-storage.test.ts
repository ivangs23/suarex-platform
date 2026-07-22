import { uploadProductImage } from "@suarex/db";
import { afterAll, describe, expect, it } from "vitest";
import { admin, nonce } from "./helpers/tenants.js";

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
    const tenantId = nonce();
    const path = await uploadProductImage(tenantId, { bytes: PNG_1x1, contentType: "image/png" });
    uploadedPaths.push(path);
    expect(path).toContain(`tenant/${tenantId}/products/`);

    // El objeto existe en el bucket.
    const { data } = await admin.storage.from("catalog").list(`tenant/${tenantId}/products`);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("rechaza un tipo no permitido", async () => {
    await expect(
      uploadProductImage(nonce(), { bytes: PNG_1x1, contentType: "application/pdf" }),
    ).rejects.toThrow(/tipo/i);
  });

  it("rechaza un fichero demasiado grande", async () => {
    const big = new Uint8Array(6 * 1024 * 1024); // 6 MB
    await expect(
      uploadProductImage(nonce(), { bytes: big, contentType: "image/png" }),
    ).rejects.toThrow(/tama/i);
  });
});
