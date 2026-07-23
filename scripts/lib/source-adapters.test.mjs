import { describe, expect, it } from "vitest";
import { elegirAdaptador } from "./source-adapters.mjs";

/**
 * Los adaptadores son lo que permite migrar clientes nuevos sin tocar el importador. Su
 * riesgo es silencioso: una traducción mal hecha no falla, importa medio catálogo o pone
 * los datos en el campo equivocado y solo se ve mirando la carta.
 */

// Forma de garum: categorías con sus productos ANIDADOS.
const VOLCADO_GARUM = [
  {
    id: "uuid-vinos",
    slug: "vinos",
    name: "Vinos",
    icon: "🍷",
    destination: "barra",
    sort_order: 0,
    parent_id: null,
    products: [],
  },
  {
    id: "uuid-tintos",
    slug: "tintos",
    name: "Tintos",
    icon: "🍷",
    destination: "barra",
    sort_order: 1,
    parent_id: "uuid-vinos",
    products: [
      {
        name: "COPA",
        description: "",
        price: 3.2,
        image_url: "https://origen/foto.png",
        allergen_ids: [1, 2],
        is_available: true,
        sort_order: 0,
        product_extras: [{ name: "Copa extra", price: 3 }],
      },
    ],
  },
];

// Forma de manuela: listas SEPARADAS, unidas por `categoryId`, con columnas por idioma.
const VOLCADO_MANUELA = {
  categories: [
    { id: "coffee", name: "Cafés", name_en: "Coffee", icon: "☕", parent_id: null, order_index: 0 },
    { id: "especiales", name: "Especiales", parent_id: "coffee", order_index: 1 },
  ],
  products: [
    {
      id: 35,
      name: "cafe con leche",
      name_en: "latte",
      desc: "",
      price: 1.6,
      categoryId: "coffee",
      image: "https://origen/cafe.jpg",
      allergens: ["lactosa"],
      modifiers: [{ name: "leche de avena", price: 0.2 }],
      order_index: 0,
    },
  ],
};

describe("adaptadores de origen", () => {
  it("reconoce el volcado de garum por su forma", () => {
    expect(elegirAdaptador(VOLCADO_GARUM).nombre).toBe("garum");
  });

  it("reconoce el volcado de manuela por su forma", () => {
    expect(elegirAdaptador(VOLCADO_MANUELA).nombre).toBe("manuela");
  });

  it("un volcado que no reconoce ninguno falla con un mensaje útil", () => {
    // Importar medio catálogo en silencio sería mucho peor que no arrancar.
    expect(() => elegirAdaptador({ cosas: [] })).toThrow(/No se reconoce el formato/);
  });

  it("garum: aplana los productos anidados y conserva el árbol", () => {
    const { categories, products } = elegirAdaptador(VOLCADO_GARUM).convierte(VOLCADO_GARUM);

    expect(categories.map((c) => c.slug)).toEqual(["vinos", "tintos"]);
    expect(categories[1]?.parentSourceId).toBe("uuid-vinos");
    expect(products).toHaveLength(1);
    expect(products[0]?.categorySourceId).toBe("uuid-tintos");
    expect(products[0]?.nameI18n).toEqual({ es: "COPA" });
    expect(products[0]?.extras).toEqual([{ nameI18n: { es: "Copa extra" }, price: 3 }]);
    expect(products[0]?.allergenIds).toEqual([1, 2]);
  });

  it("manuela: une las dos listas y trae los idiomas", () => {
    const { categories, products } = elegirAdaptador(VOLCADO_MANUELA).convierte(VOLCADO_MANUELA);

    expect(categories[0]?.nameI18n).toEqual({ es: "Cafés", en: "Coffee" });
    // Su `id` de texto ya es un identificador legible: se reutiliza como slug.
    expect(categories[0]?.slug).toBe("coffee");
    expect(categories[1]?.parentSourceId).toBe("coffee");
    expect(products[0]?.categorySourceId).toBe("coffee");
    expect(products[0]?.nameI18n).toEqual({ es: "cafe con leche", en: "latte" });
    // `modifiers` es su forma de los extras.
    expect(products[0]?.extras).toEqual([{ nameI18n: { es: "leche de avena" }, price: 0.2 }]);
  });

  it("manuela: NO copia alérgenos que no sean enteros", () => {
    // Los suyos son texto ("lactosa"). Copiarlos crearía alérgenos falsos, y equivocarse
    // con un alérgeno es un riesgo para el comensal, no un fallo cosmético.
    const { products } = elegirAdaptador(VOLCADO_MANUELA).convierte(VOLCADO_MANUELA);
    expect(products[0]?.allergenIds).toEqual([]);
  });

  it("ambos normalizan el destino a un valor que la base acepta", () => {
    // `destination` tiene un CHECK: cualquier otro valor abortaría el insert entero.
    const raro = [{ id: "x", slug: "x", name: "X", destination: "inventado", products: [] }];
    expect(elegirAdaptador(raro).convierte(raro).categories[0]?.destination).toBe("cocina");
  });

  it("genera un slug legible cuando el origen no trae ninguno", () => {
    const sinSlug = [{ id: "1", name: "Cafés y Tés", products: [] }];
    expect(elegirAdaptador(sinSlug).convierte(sinSlug).categories[0]?.slug).toBe("cafes-y-tes");
  });
});
