import { describe, expect, it } from "vitest";
import { assertDentroDelTenant, orphanPaths, pathDeUrl } from "./storage-orphans.mjs";

/**
 * Borrar es irreversible: el riesgo de esta limpieza es marcar como huérfana una foto que SÍ
 * se usa (y borrarla de una carta viva), o borrar la de otro cliente por una ruta mal
 * comparada. Estos tests fijan justo eso.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";

describe("pathDeUrl", () => {
  it("saca la ruta de una URL pública absoluta (logo/hero)", () => {
    expect(
      pathDeUrl(
        "https://x.supabase.co/storage/v1/object/public/catalog/tenant/abc/branding/l.webp",
      ),
    ).toBe("tenant/abc/branding/l.webp");
  });

  it("una ruta relativa (image_url de producto) se usa tal cual", () => {
    expect(pathDeUrl("tenant/abc/products/p.webp")).toBe("tenant/abc/products/p.webp");
  });

  it("null/no-url devuelve null, no rompe el conjunto de referenciadas", () => {
    expect(pathDeUrl(null)).toBe(null);
    expect(pathDeUrl("https://otra-cosa.com/foto.jpg")).toBe(null);
  });
});

describe("orphanPaths", () => {
  it("devuelve solo los objetos que NADIE referencia", () => {
    const objetos = [
      "tenant/a/products/1.webp",
      "tenant/a/products/2.webp",
      "tenant/a/products/vieja.webp",
    ];
    const referenciadas = new Set(["tenant/a/products/1.webp", "tenant/a/products/2.webp"]);
    expect(orphanPaths(objetos, referenciadas)).toEqual(["tenant/a/products/vieja.webp"]);
  });

  it("si todo está referenciado, no hay nada que borrar", () => {
    const objetos = ["tenant/a/products/1.webp"];
    expect(orphanPaths(objetos, new Set(["tenant/a/products/1.webp"]))).toEqual([]);
  });
});

describe("assertDentroDelTenant", () => {
  it("pasa si todas cuelgan del prefijo del cliente", () => {
    expect(() =>
      assertDentroDelTenant(TENANT, [
        `tenant/${TENANT}/products/a.webp`,
        `tenant/${TENANT}/categories/b.webp`,
      ]),
    ).not.toThrow();
  });

  it("ABORTA si una sola ruta se sale del prefijo -- no borra la foto de otro cliente", () => {
    expect(() =>
      assertDentroDelTenant(TENANT, [
        `tenant/${TENANT}/products/a.webp`,
        "tenant/OTRO/products/x.webp",
      ]),
    ).toThrow(/fuera del prefijo/);
  });
});
