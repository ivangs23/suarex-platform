import type { AdminCategory, AdminProduct } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { buildCatalogView, MAX_ITEMS } from "./catalog-view";

function prod(id: string, categoryId: string, name: string, sortOrder = 0): AdminProduct {
  return {
    id,
    categoryId,
    nameI18n: { es: name },
    descriptionI18n: {},
    price: 1,
    imageUrl: null,
    allergenIds: [],
    isAvailable: true,
    sortOrder,
    extras: [],
  };
}

function cat(
  slug: string,
  parentId: string | null,
  name: string,
  products: AdminProduct[] = [],
  sortOrder = 0,
): AdminCategory {
  return {
    id: `c-${slug}`,
    slug,
    nameI18n: { es: name },
    parentId,
    icon: null,
    destination: "cocina",
    sortOrder,
    products,
  };
}

// Misma forma que la carta real de garum: los productos cuelgan de las HOJAS, no de las
// categorías de primer nivel.
//   Vinos ─ Rioja ─ Blancos ─ (Copa, Botella)
//                 └ Tintos  ─ (Copa)
//   Cafés ─ (Café sólo, Café bombón)
const CATEGORIAS: AdminCategory[] = [
  cat("vinos", null, "Vinos", [], 0),
  cat("rioja", "c-vinos", "Rioja", [], 0),
  cat("blancos", "c-rioja", "Blancos", [
    prod("p1", "c-blancos", "COPA", 0),
    prod("p2", "c-blancos", "BOTELLA", 1),
  ]),
  cat("tintos", "c-rioja", "Tintos", [prod("p3", "c-tintos", "COPA", 0)], 1),
  cat(
    "cafes",
    null,
    "Cafés",
    [prod("p4", "c-cafes", "CAFÉ SÓLO", 0), prod("p5", "c-cafes", "CAFÉ BOMBÓN", 1)],
    1,
  ),
];

const base = { categories: CATEGORIAS, query: "", currentSlug: null, basePath: "/admin/catalogo" };

describe("buildCatalogView", () => {
  it("aplana el árbol en orden de lectura, con su profundidad", () => {
    const v = buildCatalogView(base);
    expect(v.tree.map((n) => `${"·".repeat(n.depth)}${n.name}`)).toEqual([
      "Vinos",
      "·Rioja",
      "··Blancos",
      "··Tintos",
      "Cafés",
    ]);
  });

  it("cada categoría cuenta los productos de TODO su subárbol", () => {
    const v = buildCatalogView(base);
    const porNombre = new Map(v.tree.map((n) => [n.name, n.productCount]));
    // Vinos no tiene productos propios: los 3 cuelgan de sus nietos.
    expect(porNombre.get("Vinos")).toBe(3);
    expect(porNombre.get("Rioja")).toBe(3);
    expect(porNombre.get("Blancos")).toBe(2);
    expect(porNombre.get("Cafés")).toBe(2);
  });

  it("sin filtros lista todos los productos", () => {
    const v = buildCatalogView(base);
    expect(v.matchCount).toBe(5);
    expect(v.totalProducts).toBe(5);
  });

  it("filtrar por una categoría incluye a sus DESCENDIENTES", () => {
    // Filtrar por "Vinos" y ver cero productos -- porque cuelgan de los nietos -- sería el
    // comportamiento literal pero inútil.
    const v = buildCatalogView({ ...base, currentSlug: "vinos" });
    expect(v.matchCount).toBe(3);
    expect(v.currentName).toBe("Vinos");
    expect(v.items.every((i) => i.categoryPath.startsWith("Vinos"))).toBe(true);
  });

  it("filtrar por una hoja deja solo lo suyo", () => {
    const v = buildCatalogView({ ...base, currentSlug: "tintos" });
    expect(v.items.map((i) => i.product.nameI18n.es)).toEqual(["COPA"]);
  });

  it("la búsqueda ignora mayúsculas y acentos", () => {
    // Nadie teclea acentos en un buscador; sin normalizar, "cafe" no encontraría "CAFÉ".
    const v = buildCatalogView({ ...base, query: "cafe" });
    // En el orden que fijó el gestor (sortOrder), no alfabético: dentro de una categoría
    // manda su criterio, que es como se lee la carta.
    expect(v.items.map((i) => i.product.nameI18n.es)).toEqual(["CAFÉ SÓLO", "CAFÉ BOMBÓN"]);
  });

  it("la búsqueda encuentra por trozo del nombre", () => {
    const v = buildCatalogView({ ...base, query: "bomb" });
    expect(v.matchCount).toBe(1);
  });

  it("cada resultado dice de qué categoría cuelga, con su ruta completa", () => {
    // Al buscar "copa" salen dos productos con el MISMO nombre: sin la ruta son
    // indistinguibles y el gestor no sabe cuál está editando.
    const v = buildCatalogView({ ...base, query: "copa" });
    expect(v.items.map((i) => i.categoryPath)).toEqual([
      "Vinos › Rioja › Blancos",
      "Vinos › Rioja › Tintos",
    ]);
  });

  it("búsqueda y categoría se combinan", () => {
    const v = buildCatalogView({ ...base, query: "copa", currentSlug: "blancos" });
    expect(v.matchCount).toBe(1);
    expect(v.items[0]?.categoryPath).toBe("Vinos › Rioja › Blancos");
  });

  it("una búsqueda sin resultados no rompe: lista vacía y el total intacto", () => {
    const v = buildCatalogView({ ...base, query: "zzz" });
    expect(v.matchCount).toBe(0);
    expect(v.totalProducts).toBe(5);
    // El árbol sigue entero para poder cambiar de filtro.
    expect(v.tree).toHaveLength(5);
  });

  it("marca el camino hasta la categoría actual, para dejarlo abierto", () => {
    const v = buildCatalogView({ ...base, currentSlug: "blancos" });
    const abiertos = v.tree.filter((n) => n.isOnPath).map((n) => n.name);
    expect(abiertos).toEqual(["Vinos", "Rioja", "Blancos"]);
    expect(v.tree.filter((n) => n.isCurrent).map((n) => n.name)).toEqual(["Blancos"]);
  });

  it("las migas van de la raíz a la categoría actual", () => {
    const v = buildCatalogView({ ...base, currentSlug: "blancos" });
    expect(v.currentPath.map((n) => n.name)).toEqual(["Vinos", "Rioja", "Blancos"]);
  });

  it("los enlaces del árbol conservan la búsqueda activa", () => {
    // Cambiar de categoría no debe perder lo que el gestor estaba buscando.
    const v = buildCatalogView({ ...base, query: "copa" });
    const vinos = v.tree.find((n) => n.slug === "vinos");
    expect(vinos?.href).toBe("/admin/catalogo?cat=vinos&q=copa");
  });

  it("un slug desconocido se comporta como 'todas' en vez de vaciar el panel", () => {
    const v = buildCatalogView({ ...base, currentSlug: "no-existe" });
    expect(v.currentName).toBeNull();
    expect(v.matchCount).toBe(5);
  });

  it("acota cuántos productos pinta y dice cuántos deja fuera", () => {
    // Sin tope, los 184 de garum daban una página de 30.000 píxeles: cada producto arrastra
    // su formulario de edición, sus extras y sus botones.
    const muchos = Array.from({ length: MAX_ITEMS + 25 }, (_, i) =>
      prod(`p${i}`, "c-muchos", `Producto ${i}`, i),
    );
    const v = buildCatalogView({
      ...base,
      categories: [cat("muchos", null, "Muchos", muchos)],
    });

    expect(v.items).toHaveLength(MAX_ITEMS);
    expect(v.matchCount).toBe(MAX_ITEMS + 25);
    expect(v.hiddenCount).toBe(25);
  });

  it("el recorte respeta el orden, no coge un subconjunto arbitrario", () => {
    const muchos = Array.from({ length: MAX_ITEMS + 5 }, (_, i) =>
      prod(`p${i}`, "c-muchos", `Producto ${i}`, i),
    );
    const v = buildCatalogView({
      ...base,
      categories: [cat("muchos", null, "Muchos", muchos)],
    });
    expect(v.items[0]?.product.nameI18n.es).toBe("Producto 0");
    expect(v.items.at(-1)?.product.nameI18n.es).toBe(`Producto ${MAX_ITEMS - 1}`);
  });

  it("sin tope alcanzado, hiddenCount es 0", () => {
    expect(buildCatalogView(base).hiddenCount).toBe(0);
  });

  it("un ciclo de parent_id no cuelga el panel", () => {
    // Nada en la base impide a → b → a. El panel debe degradar, no quedarse colgado.
    const ciclo = [cat("a", "c-b", "A", [prod("p1", "c-a", "Algo")]), cat("b", "c-a", "B", [])];
    const v = buildCatalogView({ ...base, categories: ciclo });
    expect(v.totalProducts).toBe(1);
    expect(v.items).toHaveLength(1);
  });
});
