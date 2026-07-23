import type { Category, Product } from "@suarex/db";
import { eurosToCents, formatCents } from "@suarex/domain";

/** Una categoría navegable del nivel actual, con el total de productos de TODO su subárbol. */
export type MenuNode = {
  id: string;
  slug: string;
  name: string;
  /** Emoji de la categoría, o `null`. Los temas lo pintan si viene; ninguno depende de él. */
  icon: string | null;
  /** URL pública de la foto de la categoría, o `null`. Manuela usa una por categoría en sus
   * tiles; garum solo emoji. Un tema la pinta si viene y cae al emoji si no. */
  imageUrl: string | null;
  productCount: number;
  href: string;
};

/** Una extra elegible del producto, con su precio ya formateado y en céntimos. */
export type MenuExtra = {
  id: string;
  name: string;
  priceCents: number;
  priceLabel: string;
};

export type MenuProduct = {
  id: string;
  name: string;
  price: number;
  /** Precio en céntimos, que es como suma el carrito: en euros, `0.1 + 0.2` no da `0.3`. */
  priceCents: number;
  /** Precio ya formateado en la moneda y el idioma del tenant, p. ej. `18,00 €`. Lo
   * calcula la vista para que ningún tema tenga que saber de locales ni de monedas. */
  priceLabel: string;
  /** URL pública completa de la foto, o `null`. Se compone aquí para que ningún tema
   * tenga que conocer el endpoint de Storage ni el nombre del bucket. */
  imageUrl: string | null;
  /** Extras que el comensal puede añadir a este producto. */
  extras: MenuExtra[];
};

export type MenuCrumb = { name: string; href: string };

/**
 * Lo que un tema necesita para pintar UN nivel de la carta. La página calcula esto; los
 * temas solo pintan -- no navegan ni consultan nada.
 */
export type MenuView = {
  /** Nombre de la categoría en la que estamos, o `null` en la raíz. */
  currentName: string | null;
  /** Ancestros del nodo actual, de la raíz hacia abajo, SIN incluir el actual. */
  breadcrumb: MenuCrumb[];
  /**
   * Enlace de vuelta al primer nivel de categorías.
   *
   * Lleva `?ver=carta` porque la raíz pelada es la pantalla de BIENVENIDA: sin él, "explorar
   * otras categorías" echaba al comensal fuera de la carta y le hacía volver a entrar.
   */
  rootHref: string;
  /** Subcategorías del nivel actual (vacío si es una hoja). */
  children: MenuNode[];
  /** Productos colgados directamente del nodo actual (vacío en la raíz). */
  products: MenuProduct[];
  /**
   * Total CRUDO de productos del tenant, sin filtrar por categoría e independiente del
   * nivel. Los temas lo exponen en `data-testid="product-count"`: si el filtro `tenant_id`
   * de `getProducts` se perdiera, este número cambiaría aunque ningún producto huérfano
   * llegara a pintarse (el filtrado por categoría ya los oculta de la vista).
   */
  totalProducts: number;
};

function categoryName(category: Category): string {
  return category.nameI18n.es ?? category.slug;
}

/**
 * Construye la vista de un nivel de la carta a partir del catálogo completo.
 *
 * Las cartas reales son ÁRBOLES, no listas: garum, por ejemplo, tiene 184 productos y 71
 * solo en vinos, organizados en varios niveles (Vinos → Rioja → Tinto → bodega → copa /
 * botella). Volcar eso en una lista plana es inusable, así que la carta se navega por
 * niveles y cada tarjeta muestra cuántos productos cuelgan de su subárbol.
 *
 * Es una función PURA (sin I/O ni JSX) para poder probarla directamente: es donde vive
 * toda la lógica de navegación -- qué hijos tocan, qué productos, y el rastro de vuelta.
 *
 * Un `currentSlug` desconocido se trata como la raíz: un enlace viejo o manipulado nunca
 * rompe la carta.
 */
export function buildMenuView(params: {
  categories: Category[];
  products: Product[];
  currentSlug: string | null;
  /** Ruta de la mesa, p. ej. `/5`; los enlaces cuelgan de aquí. */
  basePath: string;
  /** `tenant_settings.locale` / `.currency`, con los mismos valores por defecto que usa la
   * carta pública (`apps/web/app/[mesa]/page.tsx`). */
  locale?: string;
  currency?: string;
  /** Endpoint público de Storage (`NEXT_PUBLIC_SUPABASE_URL`). Sin él las fotos no se
   * pintan, en vez de componer una URL rota. */
  storageOrigin?: string;
}): MenuView {
  const {
    categories,
    products,
    currentSlug,
    basePath,
    locale = "es",
    currency = "EUR",
    storageOrigin = "",
  } = params;

  const childrenByParent = new Map<string | null, Category[]>();
  for (const category of categories) {
    const key = category.parentId;
    const siblings = childrenByParent.get(key);
    if (siblings) siblings.push(category);
    else childrenByParent.set(key, [category]);
  }

  const productsByCategory = new Map<string, Product[]>();
  for (const product of products) {
    const list = productsByCategory.get(product.categoryId);
    if (list) list.push(product);
    else productsByCategory.set(product.categoryId, [product]);
  }

  // Productos de todo el subárbol, memoizado: sin esto, una carta con varios niveles
  // recorrería el mismo subárbol una vez por tarjeta. Además, `parent_id` es una FK a la
  // propia tabla y nada en la base impide un ciclo (a → b → a): `visiting` corta el
  // descenso, así que un ciclo en los datos degrada el recuento en vez de colgar la carta.
  const subtreeCounts = new Map<string, number>();
  const visiting = new Set<string>();
  const countSubtree = (categoryId: string): number => {
    const cached = subtreeCounts.get(categoryId);
    if (cached !== undefined) return cached;
    if (visiting.has(categoryId)) return 0;
    visiting.add(categoryId);
    const own = productsByCategory.get(categoryId)?.length ?? 0;
    const fromChildren = (childrenByParent.get(categoryId) ?? []).reduce(
      (total, child) => total + countSubtree(child.id),
      0,
    );
    visiting.delete(categoryId);
    const total = own + fromChildren;
    subtreeCounts.set(categoryId, total);
    return total;
  };

  const byId = new Map(categories.map((category) => [category.id, category]));
  const current = currentSlug
    ? (categories.find((category) => category.slug === currentSlug) ?? null)
    : null;

  const hrefFor = (slug: string): string => `${basePath}?cat=${encodeURIComponent(slug)}`;

  const breadcrumb: MenuCrumb[] = [];
  if (current) {
    // Mismo motivo que en countSubtree: un ciclo de `parent_id` no puede colgar el render.
    const seen = new Set<string>([current.id]);
    let ancestorId = current.parentId;
    while (ancestorId && !seen.has(ancestorId)) {
      const ancestor = byId.get(ancestorId);
      if (!ancestor) break;
      seen.add(ancestor.id);
      breadcrumb.unshift({ name: categoryName(ancestor), href: hrefFor(ancestor.slug) });
      ancestorId = ancestor.parentId;
    }
  }

  const children = (childrenByParent.get(current?.id ?? null) ?? []).map((category) => ({
    id: category.id,
    slug: category.slug,
    name: categoryName(category),
    icon: category.icon,
    imageUrl:
      storageOrigin && category.imagePath
        ? `${storageOrigin}/storage/v1/object/public/catalog/${category.imagePath}`
        : null,
    productCount: countSubtree(category.id),
    href: hrefFor(category.slug),
  }));

  const ownProducts = current ? (productsByCategory.get(current.id) ?? []) : [];

  return {
    currentName: current ? categoryName(current) : null,
    breadcrumb,
    rootHref: `${basePath}?ver=carta`,
    children,
    products: ownProducts.map((product) => ({
      id: product.id,
      name: product.nameI18n.es ?? "",
      price: product.price,
      priceCents: eurosToCents(product.price),
      priceLabel: formatCents(eurosToCents(product.price), locale, currency),
      extras: product.extras.map((extra) => ({
        id: extra.id,
        name: extra.nameI18n.es ?? "",
        priceCents: eurosToCents(extra.price),
        priceLabel: formatCents(eurosToCents(extra.price), locale, currency),
      })),
      // Sin origen de Storage no se compone nada: mejor sin foto que con una URL rota.
      imageUrl:
        storageOrigin && product.imagePath
          ? `${storageOrigin}/storage/v1/object/public/catalog/${product.imagePath}`
          : null,
    })),
    totalProducts: products.length,
  };
}
