import type { AdminCategory, AdminProduct } from "@suarex/db";

/** Una categoría en el árbol lateral, ya aplanada con su profundidad para indentarla. */
export type CatalogTreeNode = {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  /** 0 = raíz. Solo sirve para indentar; el árbol se recorre ya ordenado. */
  depth: number;
  /** Productos de TODO su subárbol, no solo los suyos directos. */
  productCount: number;
  href: string;
  isCurrent: boolean;
  /** Está en el camino hacia la categoría actual: el árbol lo deja abierto. */
  isOnPath: boolean;
};

/** Un producto listado, con la categoría a la que pertenece ya resuelta. */
export type CatalogListItem = {
  product: AdminProduct;
  categoryId: string;
  categoryName: string;
  /** Ruta completa desde la raíz, p. ej. "Vinos › Rioja › Blancos". Imprescindible al
   * buscar: sin ella, dos "COPA" de bodegas distintas son indistinguibles. */
  categoryPath: string;
};

export type CatalogView = {
  tree: CatalogTreeNode[];
  items: CatalogListItem[];
  /** Nombre de la categoría filtrada, o `null` si se están viendo todas. */
  currentName: string | null;
  /** Ruta de la categoría filtrada, para las migas. */
  currentPath: CatalogTreeNode[];
  /** Total de productos del cliente, sin filtrar. */
  totalProducts: number;
  /** Cuántos quedan tras aplicar búsqueda y filtro. */
  matchCount: number;
  /** Cuántos de esos NO se pintan por el tope. 0 = se ven todos. */
  hiddenCount: number;
};

/**
 * Tope de productos pintados a la vez.
 *
 * Cada producto arrastra su formulario de edición, sus extras y sus botones: con los 184 de
 * garum la página medía 30.000 píxeles y ni el navegador ni el gestor podían con ella. El
 * tope la mantiene acotada SIEMPRE, también al buscar algo muy general.
 *
 * No es paginación: con el árbol y el buscador, llegar a cualquier producto son dos clics.
 * Paginar añadiría estado y una segunda forma de navegar para el mismo fin.
 */
export const MAX_ITEMS = 60;

function nombre(category: AdminCategory): string {
  return category.nameI18n.es ?? category.slug;
}

/**
 * Normaliza para buscar: sin mayúsculas y sin acentos.
 *
 * Sin quitar los acentos, buscar "cafe" no encontraría "CAFÉ" -- y nadie escribe acentos al
 * teclear rápido en un buscador. `NFD` separa la letra de su tilde y el rango Unicode borra
 * las tildes sueltas.
 */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Construye la vista del panel de catálogo: árbol de categorías, migas y lista de productos
 * filtrada por búsqueda y/o categoría.
 *
 * Existe porque el panel se volvió inusable con datos reales: la carta de garum son 184
 * productos en 59 categorías repartidas en 4 niveles, y volcarlos en una lista plana daba
 * una página de 24.000 píxeles sin forma de encontrar nada.
 *
 * Es PURA (sin JSX ni I/O) para poder probarla directamente: aquí vive toda la lógica de
 * qué se ve, que es donde de verdad se puede fallar.
 *
 * Filtrar por categoría incluye SUS DESCENDIENTES. Filtrar por "Vinos" y ver cero productos
 * -- porque los 71 cuelgan de sus nietos -- sería el comportamiento literal pero inútil.
 */
export function buildCatalogView(params: {
  categories: AdminCategory[];
  /** Texto del buscador. Vacío = no filtra. */
  query: string;
  /** Slug de la categoría seleccionada. `null` = todas. */
  currentSlug: string | null;
  /** Ruta base del panel, para componer los enlaces del árbol. */
  basePath: string;
}): CatalogView {
  const { categories, query, currentSlug, basePath } = params;

  const porId = new Map(categories.map((c) => [c.id, c]));
  const hijosDe = new Map<string | null, AdminCategory[]>();
  for (const c of categories) {
    const key = c.parentId;
    const lista = hijosDe.get(key);
    if (lista) lista.push(c);
    else hijosDe.set(key, [c]);
  }

  // Ruta desde la raíz hasta cada categoría, calculada una vez. El `seen` corta un ciclo de
  // `parent_id` (nada en la base lo impide): degrada la ruta en vez de colgar el panel.
  const rutaDe = new Map<string, AdminCategory[]>();
  function ruta(c: AdminCategory): AdminCategory[] {
    const cacheada = rutaDe.get(c.id);
    if (cacheada) return cacheada;
    const camino: AdminCategory[] = [];
    const seen = new Set<string>();
    let actual: AdminCategory | undefined = c;
    while (actual && !seen.has(actual.id)) {
      seen.add(actual.id);
      camino.unshift(actual);
      actual = actual.parentId ? porId.get(actual.parentId) : undefined;
    }
    rutaDe.set(c.id, camino);
    return camino;
  }

  const propios = new Map(categories.map((c) => [c.id, c.products.length]));
  const subtotales = new Map<string, number>();
  const visitando = new Set<string>();
  function subtotal(id: string): number {
    const cacheado = subtotales.get(id);
    if (cacheado !== undefined) return cacheado;
    if (visitando.has(id)) return 0;
    visitando.add(id);
    const total =
      (propios.get(id) ?? 0) +
      (hijosDe.get(id) ?? []).reduce((acc, hijo) => acc + subtotal(hijo.id), 0);
    visitando.delete(id);
    subtotales.set(id, total);
    return total;
  }

  const current = currentSlug ? (categories.find((c) => c.slug === currentSlug) ?? null) : null;
  const currentPathIds = new Set(current ? ruta(current).map((c) => c.id) : []);

  const hrefDe = (slug: string | null): string => {
    const params = new URLSearchParams();
    if (slug) params.set("cat", slug);
    if (query) params.set("q", query);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  // Árbol aplanado en orden de lectura (padre, luego sus hijos), con la profundidad para
  // indentar. Un recorrido en profundidad da exactamente ese orden.
  const tree: CatalogTreeNode[] = [];
  function recorrer(padreId: string | null, depth: number): void {
    const hijos = [...(hijosDe.get(padreId) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const c of hijos) {
      tree.push({
        id: c.id,
        slug: c.slug,
        name: nombre(c),
        icon: c.icon,
        depth,
        productCount: subtotal(c.id),
        href: hrefDe(c.slug),
        isCurrent: current?.id === c.id,
        isOnPath: currentPathIds.has(c.id),
      });
      recorrer(c.id, depth + 1);
    }
  }
  recorrer(null, 0);

  // Categorías cuyos productos entran en la lista: la seleccionada y sus descendientes.
  const dentroDelFiltro = new Set<string>();
  if (current) {
    const pendientes = [current.id];
    while (pendientes.length > 0) {
      const id = pendientes.pop() as string;
      if (dentroDelFiltro.has(id)) continue;
      dentroDelFiltro.add(id);
      for (const hijo of hijosDe.get(id) ?? []) pendientes.push(hijo.id);
    }
  }

  const q = normalizar(query.trim());
  const items: CatalogListItem[] = [];
  for (const c of categories) {
    if (current && !dentroDelFiltro.has(c.id)) continue;
    const camino = ruta(c)
      .map((x) => nombre(x))
      .join(" › ");
    for (const product of c.products) {
      const nombreProducto = product.nameI18n.es ?? "";
      if (q && !normalizar(nombreProducto).includes(q)) continue;
      items.push({
        product,
        categoryId: c.id,
        categoryName: nombre(c),
        categoryPath: camino,
      });
    }
  }

  // Orden estable y útil al buscar: por ruta de categoría y luego por el orden que el
  // gestor definió dentro de ella.
  items.sort(
    (a, b) =>
      a.categoryPath.localeCompare(b.categoryPath, "es") ||
      a.product.sortOrder - b.product.sortOrder,
  );

  // El recorte va DESPUÉS de ordenar: si no, el tope se llevaría un subconjunto arbitrario
  // en vez de los primeros según el criterio que ve el gestor.
  const matchCount = items.length;
  const mostrados = items.slice(0, MAX_ITEMS);

  return {
    tree,
    items: mostrados,
    currentName: current ? nombre(current) : null,
    currentPath: current
      ? ruta(current).map((c) => ({
          id: c.id,
          slug: c.slug,
          name: nombre(c),
          icon: c.icon,
          depth: 0,
          productCount: subtotal(c.id),
          href: hrefDe(c.slug),
          isCurrent: c.id === current.id,
          isOnPath: true,
        }))
      : [],
    totalProducts: categories.reduce((n, c) => n + c.products.length, 0),
    matchCount,
    hiddenCount: matchCount - mostrados.length,
  };
}
