import { AddToCart } from "../cart/AddToCart";
import { CartButton } from "../cart/CartButton";
import styles from "./generic.module.css";
import type { MenuTheme } from "./types";

/**
 * Tema por defecto de la carta. Se pinta ENTERO con las variables de marca del tenant
 * (`--color-bg/fg/primary/accent/muted`, inyectadas por el layout raíz desde
 * `tenant_settings.branding`), así que cualquier cliente nuevo obtiene una carta digna sin
 * escribir una línea de código: solo configura su branding.
 *
 * Navega por NIVELES (ver `buildMenuView`): en la raíz enseña las categorías con cuántos
 * productos cuelgan de cada una, y al entrar muestra sus subcategorías o sus productos. Una
 * carta grande (cientos de platos) es inusable en una lista plana.
 *
 * Los `data-testid` (`tenant-name`, `mesa`, `product-count`, `category`, `product`) son
 * contrato compartido por TODOS los temas -- la suite e2e los usa para verificar el
 * aislamiento entre tenants, así que un tema nuevo debe conservarlos.
 */
export const GenericTheme: MenuTheme = ({
  businessName,
  mesa,
  branding,
  view,
  welcome,
  langs,
  strings: t,
}) => {
  /* PANTALLA DE BIENVENIDA: un paso del flujo, así que la tienen TODOS los clientes, también
     los que no quieren tema propio. Aquí se pinta sola con la marca: la foto de `heroUrl` si
     la han subido, y si no el color de fondo del cliente. */
  if (welcome.active) {
    return (
      <main className={styles.page} data-theme="generic">
        <a className={styles.welcome} href={welcome.href} data-testid="welcome-enter">
          {branding.heroUrl ? (
            <img className={styles.welcomePhoto} src={branding.heroUrl} alt="" aria-hidden="true" />
          ) : null}
          <span className={styles.welcomeContent}>
            {branding.logoUrl ? (
              <img className={styles.welcomeLogo} src={branding.logoUrl} alt="" aria-hidden />
            ) : null}
            <span className={styles.name} data-testid="tenant-name">
              {businessName}
            </span>
            <span className={styles.mesa} data-testid="mesa">
              {t.table} {mesa}
            </span>
            <span className={styles.enter}>{t.enter}</span>
          </span>
        </a>
        {langs.length > 1 ? (
          <nav className={styles.langs} data-testid="lang-switch" aria-label="Idioma">
            {langs.map((lang) => (
              <a
                key={lang.code}
                className={styles.lang}
                href={lang.href}
                hrefLang={lang.code}
                data-testid="lang-option"
                data-lang={lang.code}
                aria-current={lang.active ? "true" : undefined}
              >
                {lang.label}
              </a>
            ))}
          </nav>
        ) : null}
      </main>
    );
  }

  return (
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
            {t.table} {mesa}
          </p>
          <CartButton className={styles.cartButton} />
        </header>
        {langs.length > 1 ? (
          <nav className={styles.langs} data-testid="lang-switch" aria-label="Idioma">
            {langs.map((lang) => (
              <a
                key={lang.code}
                className={styles.lang}
                href={lang.href}
                hrefLang={lang.code}
                data-testid="lang-option"
                data-lang={lang.code}
                aria-current={lang.active ? "true" : undefined}
              >
                {lang.label}
              </a>
            ))}
          </nav>
        ) : null}

        <p data-testid="product-count" hidden>
          {view.totalProducts}
        </p>

        {view.currentName ? (
          <nav className={styles.nav} data-testid="breadcrumb">
            <a className={styles.back} href={view.rootHref}>
              {t.backToCategories}
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
          <p className={styles.lead}>{t.explore}</p>
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
                    {node.productCount} {node.productCount === 1 ? t.dish : t.dishes}
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
                <AddToCart product={product} />
              </li>
            ))}
          </ul>
        ) : null}

        {view.children.length === 0 && view.products.length === 0 ? (
          <p className={styles.empty}>{t.emptyMenu}</p>
        ) : null}
      </div>
    </main>
  );
};
