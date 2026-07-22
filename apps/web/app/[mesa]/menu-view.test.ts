import type { Category, Product } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { buildMenuView } from "./menu-view";

function cat(
  slug: string,
  parentId: string | null,
  name = slug,
  icon: string | null = null,
): Category {
  return { id: `c-${slug}`, slug, parentId, nameI18n: { es: name }, icon, sortOrder: 0 };
}

function prod(id: string, categoryId: string, name: string, price: number): Product {
  return {
    id,
    categoryId,
    nameI18n: { es: name },
    descriptionI18n: {},
    price,
    isAvailable: true,
    sortOrder: 0,
    extras: [],
  };
}

// Árbol de ejemplo con la misma forma que la carta real de garum:
//   vinos → rioja → { tinto (2 productos), blanco (1 producto) }
//   tapas (1 producto directo)
const categories = [
  cat("vinos", null, "Vinos"),
  cat("tapas", null, "Tapas"),
  cat("rioja", "c-vinos", "Rioja"),
  cat("tinto", "c-rioja", "Tinto"),
  cat("blanco", "c-rioja", "Blanco"),
];
const products = [
  prod("p1", "c-tinto", "Copa", 3.5),
  prod("p2", "c-tinto", "Botella", 19),
  prod("p3", "c-blanco", "Copa blanco", 3),
  prod("p4", "c-tapas", "Croquetas", 9.5),
];

describe("buildMenuView", () => {
  it("en la raíz muestra solo las categorías de primer nivel, con el total de su subárbol", () => {
    const view = buildMenuView({ categories, products, currentSlug: null, basePath: "/5" });

    expect(view.currentName).toBeNull();
    expect(view.breadcrumb).toEqual([]);
    expect(view.products).toEqual([]);
    expect(view.children.map((c) => c.slug)).toEqual(["vinos", "tapas"]);
    // vinos agrega los 3 productos de sus nietos; tapas solo el suyo.
    expect(view.children.map((c) => c.productCount)).toEqual([3, 1]);
    expect(view.children[0]?.href).toBe("/5?cat=vinos");
  });

  it("en un nivel intermedio muestra sus hijos y el rastro de vuelta", () => {
    const view = buildMenuView({ categories, products, currentSlug: "rioja", basePath: "/5" });

    expect(view.currentName).toBe("Rioja");
    expect(view.breadcrumb).toEqual([{ name: "Vinos", href: "/5?cat=vinos" }]);
    expect(view.children.map((c) => c.slug)).toEqual(["tinto", "blanco"]);
    expect(view.children.map((c) => c.productCount)).toEqual([2, 1]);
    expect(view.products).toEqual([]);
  });

  it("en una hoja muestra los productos y ningún hijo", () => {
    const view = buildMenuView({ categories, products, currentSlug: "tinto", basePath: "/5" });

    expect(view.children).toEqual([]);
    expect(view.products.map((p) => p.name)).toEqual(["Copa", "Botella"]);
    expect(view.products.map((p) => p.price)).toEqual([3.5, 19]);
    // El rastro completo, de la raíz hacia abajo.
    expect(view.breadcrumb.map((b) => b.name)).toEqual(["Vinos", "Rioja"]);
  });

  it("una categoría de primer nivel con productos propios los muestra al entrar", () => {
    const view = buildMenuView({ categories, products, currentSlug: "tapas", basePath: "/5" });
    expect(view.products.map((p) => p.name)).toEqual(["Croquetas"]);
    expect(view.breadcrumb).toEqual([]);
  });

  it("un slug desconocido se comporta como la raíz (un enlace viejo no rompe la carta)", () => {
    const view = buildMenuView({ categories, products, currentSlug: "no-existe", basePath: "/5" });
    expect(view.currentName).toBeNull();
    expect(view.children.map((c) => c.slug)).toEqual(["vinos", "tapas"]);
  });

  it("totalProducts es el crudo del tenant, no el del nivel", () => {
    const root = buildMenuView({ categories, products, currentSlug: null, basePath: "/5" });
    const leaf = buildMenuView({ categories, products, currentSlug: "tinto", basePath: "/5" });
    expect(root.totalProducts).toBe(4);
    expect(leaf.totalProducts).toBe(4);
  });

  it("pasa el icono de la categoría, y null cuando no tiene", () => {
    // Una categoría sin icono es válida: el tema no debe pintar un hueco ni romperse.
    const view = buildMenuView({
      categories: [cat("vinos", null, "Vinos", "🍷"), cat("tapas", null, "Tapas")],
      products: [],
      currentSlug: null,
      basePath: "/5",
    });
    expect(view.children.map((c) => c.icon)).toEqual(["🍷", null]);
  });

  it("formatea el precio en el idioma y la moneda del tenant", () => {
    const es = buildMenuView({ categories, products, currentSlug: "tinto", basePath: "/5" });
    // Espacio duro entre importe y símbolo, como en formatCents (@suarex/domain).
    expect(es.products[0]?.priceLabel).toBe(`3,50 €`);

    const en = buildMenuView({
      categories,
      products,
      currentSlug: "tinto",
      basePath: "/5",
      locale: "en-US",
      currency: "USD",
    });
    expect(en.products[0]?.priceLabel).toBe("$3.50");
  });

  it("un ciclo de parent_id no cuelga la carta", () => {
    // Nada en la base impide a → b → a; la carta es pública, así que un ciclo tiene que
    // degradar, no colgar el render.
    const ciclo = [cat("a", "c-b", "A"), cat("b", "c-a", "B")];
    const view = buildMenuView({
      categories: ciclo,
      products: [prod("p1", "c-a", "Algo", 1)],
      currentSlug: "a",
      basePath: "/5",
    });

    expect(view.currentName).toBe("A");
    expect(view.products.map((p) => p.name)).toEqual(["Algo"]);
    // El rastro se corta al volver a un ancestro ya visto.
    expect(view.breadcrumb.map((b) => b.name)).toEqual(["B"]);
  });

  it("escapa el slug en el enlace", () => {
    const view = buildMenuView({
      categories: [cat("con espacio", null)],
      products: [],
      currentSlug: null,
      basePath: "/5",
    });
    expect(view.children[0]?.href).toBe("/5?cat=con%20espacio");
  });
});
