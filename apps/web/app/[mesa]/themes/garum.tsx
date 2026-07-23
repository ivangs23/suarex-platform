import { AddToCart } from "../cart/AddToCart";
import styles from "./garum.module.css";
import type { MenuTheme } from "./types";

/**
 * Tema A MEDIDA de Garum Vinoteca: reproduce su carta real (garumvinoteca.com) -- fondo
 * verde con su patrón, cabecera fija con su logo, tarjetas blancas con títulos serif en
 * versales y el recuento de platos de cada categoría.
 *
 * Fija sus colores, su tipografía y sus assets en su propio CSS/JSX en vez de leerlos de
 * `branding` -- un tema a medida es precisamente eso. Aun así recibe el MISMO contrato de
 * props que el resto (`MenuThemeProps`) y conserva los `data-testid` compartidos.
 */
export const GarumTheme: MenuTheme = ({
  businessName,
  mesa,
  branding,
  view,
  welcome,
  langs,
  strings: t,
}) => {
  /* PANTALLA DE BIENVENIDA: el paso previo a la carta, igual que en cualquier otro tema. Lo
     que cambia aquí es cómo se ve -- su verde, su patrón, su logo -- y la foto, que sale del
     ajuste `heroUrl` del cliente. */
  if (welcome.active) {
    return (
      <main className={styles.page} data-theme="garum">
        <a className={styles.welcome} href={welcome.href} data-testid="welcome-enter">
          {branding.heroUrl ? (
            <img className={styles.welcomePhoto} src={branding.heroUrl} alt="" aria-hidden="true" />
          ) : null}
          <span className={styles.welcomeContent}>
            <img className={styles.welcomeLogo} src="/brands/garum-logo.png" alt="" aria-hidden />
            <span className={styles.heroTitle} data-testid="tenant-name">
              {businessName}
            </span>
            <span className={styles.heroLead}>Vinoteca &amp; cocina de producto</span>
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
    <main className={styles.page} data-theme="garum">
      <header className={styles.topbar}>
        {/* Asset de marca versionado con la app (no es el logo por tenant de Storage), pero
          se sirve estático: <img> a propósito, sin optimizar. */}
        <img className={styles.logo} src="/brands/garum-logo.png" alt={businessName} />
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

      <div className={styles.inner}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle} data-testid="tenant-name">
            {businessName}
          </h1>
          <p className={styles.heroLead}>Vinoteca &amp; cocina de producto</p>
          <p className={styles.mesa} data-testid="mesa">
            {t.table} {mesa}
          </p>
        </section>

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
        ) : null}

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
