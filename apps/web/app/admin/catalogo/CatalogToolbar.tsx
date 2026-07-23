import styles from "./catalogo.module.css";

/**
 * Buscador y filtro del catálogo.
 *
 * Es un `<form method="get">` normal, sin estado de cliente: los filtros viven en la URL
 * (`?q=`, `?cat=`). Así funciona sin JavaScript, el enlace es compartible, el botón "atrás"
 * hace lo esperado y el servidor sigue siendo la única fuente de verdad -- el mismo criterio
 * que la carta pública, que navega con `?cat=`.
 */
export function CatalogToolbar({
  query,
  currentSlug,
  basePath,
}: {
  query: string;
  currentSlug: string | null;
  basePath: string;
}) {
  return (
    <form className={styles.toolbar} method="get" action={basePath}>
      {/* La categoría seleccionada viaja oculta: buscar no debe sacarte de la categoría en
          la que estabas mirando. */}
      {currentSlug ? <input type="hidden" name="cat" value={currentSlug} /> : null}
      <input
        className={styles.search}
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Buscar un producto por su nombre…"
        aria-label="Buscar un producto"
        data-testid="catalog-search"
      />
      <button type="submit">Buscar</button>
      {query || currentSlug ? (
        <a href={basePath} data-testid="catalog-clear">
          Quitar filtros
        </a>
      ) : null}
    </form>
  );
}
