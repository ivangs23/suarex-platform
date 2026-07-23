import styles from "./manuela.module.css";
import type { MenuTheme } from "./types";

/**
 * Tema A MEDIDA de Manuela Desayuna: crema/dorado, tiles redondeados en rejilla -- el
 * lenguaje de su kiosko táctil original, ahora navegando por niveles. Fija sus colores en su
 * CSS; recibe el MISMO contrato de props que el resto y conserva los `data-testid`
 * compartidos.
 */
export const ManuelaTheme: MenuTheme = ({ businessName, mesa, branding, view }) => (
  <main className={styles.page} data-theme="manuela">
    {/* Su cabecera real: la foto de la pared de casetes de su local con la firma
        manuscrita encima. Assets versionados con la app (no el logo por tenant de
        Storage), servidos estáticos: <img> a propósito, sin optimizar. */}
    {/* Su héroe real, medido sobre manueladesayuna.com: la foto de la pared de casetes de
        su local a sangre, la firma manuscrita encima, la insignia verde con la taza y el
        saludo en versales enormes (72 px, peso 900, tracking -0.05em). */}
    <header className={styles.hero}>
      <img className={styles.heroPhoto} src="/brands/manuela-fondo.png" alt="" aria-hidden="true" />
      <div className={styles.heroContent}>
        <img className={styles.signature} src="/brands/manuela-logo.png" alt={businessName} />
        <span className={styles.badge} aria-hidden="true">
          ☕
        </span>
        <h1 className={styles.greeting} data-testid="tenant-name">
          {businessName}
        </h1>
        <p className={styles.mesa} data-testid="mesa">
          Mesa {mesa}
        </p>
      </div>
    </header>

    <div className={styles.inner}>
      <p data-testid="product-count" hidden>
        {view.totalProducts}
      </p>

      {view.currentName ? (
        <nav className={styles.nav}>
          <a className={styles.back} href={view.rootHref}>
            ← Explorar otras categorías
          </a>
          <p className={styles.crumbs}>
            {view.breadcrumb.map((crumb) => (
              <span key={crumb.href}>
                <a href={crumb.href}>{crumb.name}</a> ›{" "}
              </span>
            ))}
            <strong>{view.currentName}</strong>
          </p>
        </nav>
      ) : (
        <p className={styles.lead}>¿Qué te apetece hoy?</p>
      )}

      {view.children.length > 0 ? (
        <ul className={styles.grid}>
          {view.children.map((node) => (
            <li key={node.id} data-testid="category">
              <a className={styles.card} href={node.href}>
                {/* Su carta usa una FOTO por categoría; el emoji queda de respaldo cuando no
                    la hay. aria-hidden en ambos: el nombre de al lado ya dice qué es, y sin
                    esto un lector de pantalla anunciaría "taza de café Cafés". */}
                {node.imageUrl ? (
                  <img
                    className={styles.cardPhoto}
                    src={node.imageUrl}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                  />
                ) : node.icon ? (
                  <span className={styles.cardIcon} aria-hidden="true">
                    {node.icon}
                  </span>
                ) : null}
                <span className={styles.cardName}>{node.name}</span>
                <span className={styles.cardCount}>
                  {node.productCount} {node.productCount === 1 ? "plato" : "platos"}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {view.products.length > 0 ? (
        <ul className={styles.items}>
          {view.products.map((product) => (
            <li key={product.id} className={styles.item} data-testid="product">
              <div className={styles.itemText}>
                <span className={styles.itemName}>{product.name}</span>
                <span className={styles.price}>{product.priceLabel}</span>
              </div>
              {/* La foto es de Storage por tenant, una URL absoluta que next/image no puede
                  optimizar sin configurar `remotePatterns` con un host que varía por
                  despliegue: <img> a propósito. `loading="lazy"` porque una categoría puede
                  traer decenas y casi ninguna entra en la primera pantalla. */}
              {product.imageUrl ? (
                <img
                  className={styles.itemPhoto}
                  data-testid="product-photo"
                  src={product.imageUrl}
                  alt=""
                  loading="lazy"
                  width={88}
                  height={88}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {view.children.length === 0 && view.products.length === 0 ? (
        <p className={styles.empty}>La carta todavía no tiene productos.</p>
      ) : null}
    </div>
  </main>
);
