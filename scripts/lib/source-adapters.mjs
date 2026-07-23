/**
 * ADAPTADORES DE ORIGEN.
 *
 * Cada cliente que migramos trae su carta en el esquema que se inventó su aplicación
 * anterior. Los dos primeros ya no se parecen en nada:
 *
 *   garum    categorías con `id` uuid, productos ANIDADOS dentro de cada categoría,
 *            extras en `product_extras`, un solo idioma
 *   manuela  categorías con `id` de texto, productos en una lista APARTE que apunta con
 *            `categoryId`, extras en un `modifiers` json, y columnas por idioma
 *            (`name_en`, `name_pt`)
 *
 * Meter esas diferencias dentro del importador lo habría llenado de condicionales que
 * crecen con cada cliente nuevo. En vez de eso, cada origen se traduce aquí a UNA forma
 * canónica y el importador solo conoce esa forma.
 *
 * Para añadir un cliente nuevo: escribe un adaptador con su `detecta` y su `convierte`, y
 * añádelo a `ADAPTADORES`. No se toca el importador.
 */

/**
 * @typedef {object} CategoriaCanonica
 * @property {string} sourceId   Id en el origen, para resolver los padres.
 * @property {string} slug       Identificador en la URL de la plataforma.
 * @property {Record<string,string>} nameI18n
 * @property {string|null} icon
 * @property {string|null} imageUrl
 * @property {string|null} parentSourceId
 * @property {string} destination  'cocina' | 'barra'
 * @property {number} sortOrder
 */

/**
 * @typedef {object} ProductoCanonico
 * @property {string} categorySourceId
 * @property {Record<string,string>} nameI18n
 * @property {Record<string,string>} descriptionI18n
 * @property {number} price
 * @property {string|null} imageUrl
 * @property {number[]} allergenIds
 * @property {boolean} isAvailable
 * @property {number} sortOrder
 * @property {{ nameI18n: Record<string,string>, price: number }[]} extras
 */

/** Une los campos por idioma en el jsonb `{es, en, pt}` que usa la plataforma. */
function i18n({ es, en, pt }) {
  const out = {};
  if (es) out.es = es;
  if (en) out.en = en;
  if (pt) out.pt = pt;
  return out;
}

/** `destination` tiene un CHECK en la base: cualquier otro valor abortaría el insert. */
function destinoValido(valor) {
  return valor === "barra" || valor === "cocina" ? valor : "cocina";
}

/**
 * Convierte un texto libre en un slug utilizable en una URL.
 *
 * Solo se usa cuando el origen NO trae uno (manuela identifica sus categorías por un `id`
 * de texto que ya sirve). Quita los acentos antes de filtrar, para que "Cafés" no acabe en
 * "caf-s".
 */
function aSlug(texto, respaldo) {
  const base = String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || respaldo;
}

/**
 * Origen tipo GARUM: un array de categorías con sus productos anidados.
 */
const adaptadorGarum = {
  nombre: "garum",
  detecta: (json) => Array.isArray(json) && json.length > 0 && "products" in json[0],
  convierte(json) {
    const categories = json.map((c) => ({
      sourceId: c.id,
      slug: c.slug ?? aSlug(c.name, c.id),
      nameI18n: i18n({ es: c.name }),
      icon: c.icon ?? null,
      imageUrl: c.image_url ?? null,
      parentSourceId: c.parent_id ?? null,
      destination: destinoValido(c.destination),
      sortOrder: c.sort_order ?? 0,
    }));

    const products = json.flatMap((c) =>
      (c.products ?? []).map((p) => ({
        categorySourceId: c.id,
        nameI18n: i18n({ es: p.name }),
        descriptionI18n: i18n({ es: p.description }),
        price: p.price ?? 0,
        imageUrl: p.image_url || null,
        allergenIds: (p.allergen_ids ?? []).filter((a) => Number.isInteger(a)),
        isAvailable: p.is_available ?? true,
        sortOrder: p.sort_order ?? 0,
        extras: (p.product_extras ?? []).map((e) => ({
          nameI18n: i18n({ es: e.name }),
          price: e.price ?? 0,
        })),
      })),
    );

    return { categories, products };
  },
};

/**
 * Origen tipo MANUELA: `{ categories, products }` en listas separadas, productos apuntando
 * a su categoría por `categoryId`, extras en `modifiers`, y columnas por idioma.
 */
const adaptadorManuela = {
  nombre: "manuela",
  detecta: (json) =>
    !Array.isArray(json) && Array.isArray(json?.categories) && Array.isArray(json?.products),
  convierte(json) {
    const categories = json.categories.map((c) => ({
      sourceId: String(c.id),
      // Su `id` ya ES un identificador legible ("coffee", "especiales"): se reutiliza en vez
      // de inventar otro, así los enlaces que ya circulen siguen teniendo sentido.
      slug: aSlug(c.id, aSlug(c.name, String(c.id))),
      nameI18n: i18n({ es: c.name, en: c.name_en, pt: c.name_pt }),
      icon: c.icon ?? null,
      imageUrl: c.image || null,
      parentSourceId: c.parent_id ? String(c.parent_id) : null,
      destination: destinoValido(c.destination),
      sortOrder: c.order_index ?? 0,
    }));

    const products = json.products.map((p) => ({
      categorySourceId: String(p.categoryId),
      nameI18n: i18n({ es: p.name, en: p.name_en, pt: p.name_pt }),
      descriptionI18n: i18n({ es: p.desc, en: p.desc_en, pt: p.desc_pt }),
      price: p.price ?? 0,
      imageUrl: p.image || null,
      // Sus `allergens` son texto, no los enteros de nuestro catálogo: copiarlos crearía
      // alérgenos falsos, y equivocarse con un alérgeno es un riesgo para el comensal.
      allergenIds: (p.allergens ?? []).filter((a) => Number.isInteger(a)),
      isAvailable: p.is_available ?? true,
      sortOrder: p.order_index ?? 0,
      extras: (p.modifiers ?? []).map((m) => ({
        nameI18n: i18n({ es: m.name }),
        price: m.price ?? 0,
      })),
    }));

    return { categories, products };
  },
};

export const ADAPTADORES = [adaptadorGarum, adaptadorManuela];

/**
 * Elige el adaptador que reconoce este volcado.
 *
 * Se detecta por la FORMA del json, no por un parámetro: pasar el volcado equivocado con el
 * formato equivocado importaría medio catálogo en silencio, y un `--formato` que hay que
 * acordarse de escribir es justo el tipo de dato que se pone mal.
 */
export function elegirAdaptador(json) {
  const encontrado = ADAPTADORES.find((a) => a.detecta(json));
  if (!encontrado) {
    throw new Error(
      `No se reconoce el formato del volcado. Adaptadores disponibles: ` +
        `${ADAPTADORES.map((a) => a.nombre).join(", ")}. ` +
        `Escribe uno nuevo en scripts/lib/source-adapters.mjs (ver su docstring).`,
    );
  }
  return encontrado;
}
