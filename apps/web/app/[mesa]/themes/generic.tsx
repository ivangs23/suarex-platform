import styles from "./generic.module.css";
import type { MenuTheme } from "./types";

/**
 * Tema por defecto de la carta. Se pinta ENTERO con las variables de marca del tenant
 * (`--color-bg/fg/primary/accent/muted`, inyectadas por el layout raíz desde
 * `tenant_settings.branding`), así que cualquier cliente nuevo obtiene una carta digna sin
 * escribir una línea de código: solo configura su branding.
 *
 * Los `data-testid` (`tenant-name`, `mesa`, `product-count`, `category`, `product`) son
 * contrato compartido por TODOS los temas -- la suite e2e existente los usa para verificar
 * el aislamiento entre tenants, así que un tema nuevo debe conservarlos.
 */
export const GenericTheme: MenuTheme = ({
  businessName,
  mesa,
  branding,
  categories,
  productCount,
}) => (
  <main className={styles.page} data-theme="generic">
    <div className={styles.inner}>
      <header className={styles.header}>
        {/* El logo es una URL absoluta de Storage por tenant, no un asset local que
            next/image pueda optimizar en build: se usa <img> a propósito. */}
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
