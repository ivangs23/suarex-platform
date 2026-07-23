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
    <header className={styles.topbar}>
      <img
        className={styles.topbarPhoto}
        src="/brands/manuela-fondo.png"
        alt=""
        aria-hidden="true"
      />
      <img className={styles.signature} src="/brands/manuela-logo.png" alt={businessName} />
    </header>

    <div className={styles.inner}>
      <header className={styles.header}>
        {/* Logo por tenant desde una URL absoluta de Storage, no un asset local
            optimizable en build: <img> a propósito. */}
        {branding.logoUrl ? (
          <img className={styles.logo} src={branding.logoUrl} alt={businessName} />
        ) : null}
        <h1 className={styles.name} data-testid="tenant-name">
          {businessName}
        </h1>
        <p className={styles.mesa} data-testid="mesa">
          Mesa {mesa}
        </p>
      </header>

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
                {/* aria-hidden: el emoji es apoyo visual, el nombre de al lado ya dice qué
                    es. Sin esto, un lector de pantalla anuncia "copa de vino Vinos". */}
                {node.icon ? (
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
