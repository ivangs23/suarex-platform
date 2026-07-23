import type { CatalogTreeNode } from "./catalog-view";
import styles from "./catalogo.module.css";

/**
 * Árbol de categorías. Enlaces normales que fijan `?cat=` -- sin estado de cliente.
 *
 * Se pinta APLANADO con sangría por profundidad, no con `<details>` anidados: con 59
 * categorías en 4 niveles, tener que abrir tres desplegables para llegar a una hoja es peor
 * que verlas todas y recorrerlas con la vista. La sangría y el resaltado del camino actual
 * bastan para situarse.
 */
export function CategoryTree({
  nodes,
  allHref,
  showingAll,
}: {
  nodes: CatalogTreeNode[];
  allHref: string;
  showingAll: boolean;
}) {
  return (
    <nav className={styles.tree} aria-label="Categorías">
      <ul className={styles.treeList}>
        <li>
          <a
            className={styles.treeLink}
            href={allHref}
            aria-current={showingAll ? "true" : undefined}
          >
            <span className={styles.treeName}>Todas las categorías</span>
          </a>
        </li>
        {nodes.map((node) => (
          <li key={node.id} data-testid="tree-category">
            <a
              className={styles.treeLink}
              href={node.href}
              // La sangría va en línea porque depende de un dato (la profundidad), no de un
              // estado: una clase por nivel obligaría a inventar un tope arbitrario de
              // niveles y a mantenerlo sincronizado con los datos del cliente.
              style={{ paddingLeft: `${0.5 + node.depth * 0.85}rem` }}
              aria-current={node.isCurrent ? "true" : undefined}
              data-on-path={node.isOnPath}
            >
              {node.icon ? <span aria-hidden="true">{node.icon}</span> : null}
              <span className={styles.treeName}>{node.name}</span>
              <span className={styles.treeCount}>{node.productCount}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
