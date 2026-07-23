import { removeProductImage, uploadProductImage } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/** PNG de 1x1 válido y mínimo: ejerce el camino real de subida, no un buffer inventado. */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/**
 * Subida y borrado de fotos de producto.
 *
 * El borrado es lo que tiene riesgo: `catalogBucket()` usa service role, así que sin la
 * comprobación de prefijo una ruta manipulada borraría la foto de OTRO cliente.
 */
describe("fotos de producto", () => {
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  const suffix = nonce();

  beforeAll(async () => {
    tenantA = await createTenantFixture(`img-a-${suffix}`);
    tenantB = await createTenantFixture(`img-b-${suffix}`);
  });

  afterAll(async () => {
    await deleteTenantFixture(tenantA);
    await deleteTenantFixture(tenantB);
  });

  it("sube bajo el prefijo del cliente y devuelve su ruta", async () => {
    const path = await uploadProductImage(tenantA.tenantId, {
      bytes: new Uint8Array(PIXEL_PNG),
      contentType: "image/png",
    });
    expect(path.startsWith(`tenant/${tenantA.tenantId}/products/`)).toBe(true);
    expect(path.endsWith(".png")).toBe(true);
  });

  it("rechaza un tipo que no está permitido", async () => {
    await expect(
      uploadProductImage(tenantA.tenantId, {
        bytes: new Uint8Array(PIXEL_PNG),
        // El formato por defecto de las fotos de iPhone: si el `accept` del formulario
        // usara el comodín `image/*`, el gestor podría elegirlo y morir aquí.
        contentType: "image/heic",
      }),
    ).rejects.toThrow(/Tipo de imagen no permitido/);
  });

  it("borra la foto que sí es suya", async () => {
    const path = await uploadProductImage(tenantA.tenantId, {
      bytes: new Uint8Array(PIXEL_PNG),
      contentType: "image/png",
    });
    await expect(removeProductImage(tenantA.tenantId, path)).resolves.toBeUndefined();
  });

  it("NO deja borrar la foto de otro cliente", async () => {
    // El control que de verdad importa: el bucket se escribe con service role, así que
    // una ruta manipulada sin esta comprobación borraría el fichero del otro cliente.
    const ajena = await uploadProductImage(tenantB.tenantId, {
      bytes: new Uint8Array(PIXEL_PNG),
      contentType: "image/png",
    });

    await expect(removeProductImage(tenantA.tenantId, ajena)).rejects.toThrow(
      /no pertenece a este cliente/,
    );

    // Y sigue estando: el intento fallido no se la llevó por delante.
    await expect(removeProductImage(tenantB.tenantId, ajena)).resolves.toBeUndefined();
  });

  it("rechaza rutas que intentan escaparse del prefijo", async () => {
    for (const ruta of [
      `tenant/${tenantB.tenantId}/products/x.png`,
      "tenant/../secreto.png",
      `../tenant/${tenantA.tenantId}/products/x.png`,
      "",
    ]) {
      await expect(removeProductImage(tenantA.tenantId, ruta)).rejects.toThrow(
        /no pertenece a este cliente/,
      );
    }
  });

  it("borrar algo que ya no está no es un error", async () => {
    // El fin es que deje de existir; si otra ejecución se adelantó, el resultado es el mismo.
    const path = `tenant/${tenantA.tenantId}/products/no-existe-${suffix}.png`;
    await expect(removeProductImage(tenantA.tenantId, path)).resolves.toBeUndefined();
  });
});
