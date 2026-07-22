import { uploadBrandingLogo } from "@suarex/db";
import { afterAll, describe, expect, it } from "vitest";
import { admin } from "./helpers/tenants.js";

const PNG_1x1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const uploadedPaths: string[] = [];

afterAll(async () => {
  if (uploadedPaths.length === 0) return;
  const { error } = await admin.storage.from("catalog").remove(uploadedPaths);
  if (error) throw error;
});

describe("uploadBrandingLogo", () => {
  it("sube un PNG bajo tenant/{id}/branding y devuelve una URL pública absoluta que responde 200", async () => {
    const tenantId = crypto.randomUUID();
    const url = await uploadBrandingLogo(tenantId, { bytes: PNG_1x1, contentType: "image/png" });
    // Guardar la ruta relativa para limpiar.
    const marker = "/storage/v1/object/public/catalog/";
    const path = url.slice(url.indexOf(marker) + marker.length);
    uploadedPaths.push(path);

    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain(`tenant/${tenantId}/branding/`);
    const res = await fetch(url);
    expect(res.status).toBe(200);
  });

  it("rechaza un tipo no permitido antes de tocar Storage", async () => {
    await expect(
      uploadBrandingLogo(crypto.randomUUID(), { bytes: PNG_1x1, contentType: "application/pdf" }),
    ).rejects.toThrow(/tipo/i);
  });

  it("rechaza un fichero demasiado grande", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    await expect(
      uploadBrandingLogo(crypto.randomUUID(), { bytes: big, contentType: "image/png" }),
    ).rejects.toThrow(/tama/i);
  });

  it("rechaza un tenantId con '../' antes de tocar Storage", async () => {
    await expect(
      uploadBrandingLogo("../evil", { bytes: PNG_1x1, contentType: "image/png" }),
    ).rejects.toThrow(/tenantId/i);
  });
});
