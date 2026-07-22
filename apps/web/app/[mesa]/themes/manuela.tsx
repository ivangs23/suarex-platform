import styles from "./manuela.module.css";
import type { MenuTheme } from "./types";

/**
 * Tema A MEDIDA de Manuela Desayuna: crema/dorado, tiles redondeados en rejilla -- el
 * lenguaje de su kiosko táctil original. Fija sus colores en su CSS; recibe el MISMO
 * contrato de props que el resto y conserva los `data-testid` compartidos.
 */
export const ManuelaTheme: MenuTheme = ({
  businessName,
  mesa,
  branding,
  categories,
  productCount,
}) => (
  <main className={styles.page} data-theme="manuela">
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
        {productCount}
      </p>

      {categories.length === 0 ? (
        <p className={styles.empty}>La carta todavía no tiene productos.</p>
      ) : null}

      {categories.map((category) => (
        <section key={category.id} className={styles.category} data-testid="category">
          <h2 className={styles.categoryName}>{category.name}</h2>
          <ul className={styles.items}>
            {category.products.map((product) => (
              <li key={product.id} className={styles.item} data-testid="product">
                <span className={styles.itemName}>{product.name}</span>
                <span className={styles.price}>{product.price.toFixed(2)} €</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  </main>
);
