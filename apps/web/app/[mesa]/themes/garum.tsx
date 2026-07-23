import Image from "next/image";
import { AllergenBadges } from "../allergens/AllergenBadges";
import { AddToCart } from "../cart/AddToCart";
import { CartButton } from "../cart/CartButton";
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
            <Image
              className={styles.welcomePhoto}
              src={branding.heroUrl}
              alt=""
              aria-hidden
              fill
              sizes="100vw"
              unoptimized
            />
          ) : null}
          <span className={styles.welcomeContent}>
            <Image
              className={styles.welcomeLogo}
              src="/brands/garum-logo.png"
              alt=""
              aria-hidden
              width={786}
              height={472}
            />
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
      {/* Cabecera en TRES zonas, igual que en el resto de temas: la mesa a un lado, la marca
          centrada, y a la derecha los idiomas con la bolsa del pedido. Que estos controles
          estén en el MISMO sitio en todos los temas es parte de la regla: cambia el aspecto,
          no dónde encuentra el comensal cada cosa. Asset de marca versionado con la app (no
          el logo por tenant de Storage), servido estático: <img> a propósito. */}
      <header className={styles.topbar}>
        <span className={styles.mesa} data-testid="mesa">
          {t.table} {mesa}
        </span>

        <Image
          className={styles.logo}
          src="/brands/garum-logo.png"
          alt={businessName}
          width={786}
          height={472}
        />

        <div className={styles.topbarEnd}>
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
          <CartButton className={styles.cartButton} />
        </div>
      </header>

      <div className={styles.inner}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle} data-testid="tenant-name">
            {businessName}
          </h1>
          <p className={styles.heroLead}>Vinoteca &amp; cocina de producto</p>
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
                  <AllergenBadges allergens={product.allergens} />
                </div>
                {/* Foto de Storage por tenant. Ya se sube optimizada (900px WebP, ver
                  packages/db/src/image.js), así que va con `unoptimized`: next/image no la
                  re-optimiza (sería CPU de más en el VPS sobre algo ya optimizado), pero sí
                  aporta el lazy-load y las dimensiones que evitan el salto de layout. */}
                {product.imageUrl ? (
                  <Image
                    className={styles.itemPhoto}
                    data-testid="product-photo"
                    src={product.imageUrl}
                    alt=""
                    width={88}
                    height={88}
                    unoptimized
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
