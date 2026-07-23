import Image from "next/image";
import { AllergenBadges } from "../allergens/AllergenBadges";
import { AddToCart } from "../cart/AddToCart";
import { CartButton } from "../cart/CartButton";
import styles from "./manuela.module.css";
import type { MenuTheme } from "./types";

/**
 * Tema A MEDIDA de Manuela Desayuna: crema/dorado, tiles redondeados en rejilla -- el
 * lenguaje de su kiosko táctil original, ahora navegando por niveles. Fija sus colores en su
 * CSS; recibe el MISMO contrato de props que el resto y conserva los `data-testid`
 * compartidos.
 */
/* Banderas del selector, como en su sitio. Son DECORACIÓN (`aria-hidden`): una bandera no
   identifica un idioma -- el portugués de Brasil no lleva la de Portugal -- así que el que
   manda es el código de al lado, que es lo que lee un lector de pantalla. */
const LANG_FLAGS: Record<string, string> = { es: "🇪🇸", en: "🇬🇧", pt: "🇵🇹" };

export const ManuelaTheme: MenuTheme = ({
  businessName,
  mesa,
  branding,
  view,
  welcome,
  langs,
  strings: t,
}) => {
  /* PANTALLA DE BIENVENIDA: un paso propio, no una cabecera que se desplaza. Su carta real
     arranca así y solo al tocar entra a los productos. */
  if (welcome.active) {
    return (
      <main className={styles.page} data-theme="manuela">
        <a className={styles.welcome} href={welcome.href} data-testid="welcome-enter">
          {/* La foto de la bienvenida es un AJUSTE del cliente (`heroUrl`): puede cambiarla
              desde su panel sin tocar código. La pared de casetes de su local queda de
              respaldo mientras no suba otra. */}
          <Image
            className={styles.heroPhoto}
            src={branding.heroUrl ?? "/brands/manuela-fondo.png"}
            alt=""
            aria-hidden
            fill
            sizes="100vw"
            priority
          />
          <span className={styles.heroContent}>
            <Image
              className={styles.signature}
              src="/brands/manuela-logo.png"
              alt={businessName}
              width={1283}
              height={282}
              priority
            />
            <span className={styles.badge} aria-hidden="true">
              ☕
            </span>
            <span className={styles.greeting} data-testid="tenant-name">
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
    <main className={styles.page} data-theme="manuela">
      {/* Cabecera en TRES zonas: la mesa a un lado, la firma centrada y a la derecha los
          idiomas con la bolsa del pedido. La firma va suelta y centrada -- es la marca, no un
          dato de la mesa -- y hace de enlace de vuelta al inicio.

          Asset versionado con la app (no el logo por tenant de Storage), servido estático:
          <img> a propósito, sin optimizar. */}
      <header className={styles.topbar}>
        <span className={styles.mesaPill} data-testid="mesa">
          {t.table} {mesa}
        </span>

        <a
          className={styles.brand}
          href={welcome.href.replace("?ver=carta", "")}
          aria-label="Volver al inicio"
        >
          <Image
            className={styles.topbarLogo}
            src="/brands/manuela-logo.png"
            alt={businessName}
            width={1283}
            height={282}
          />
        </a>

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
                  {LANG_FLAGS[lang.code] ? (
                    <span aria-hidden="true">{LANG_FLAGS[lang.code]}</span>
                  ) : null}
                  {lang.label}
                </a>
              ))}
            </nav>
          ) : null}

          <CartButton className={styles.cartButton} />
        </div>
      </header>

      <div className={styles.inner}>
        <p data-testid="product-count" hidden>
          {view.totalProducts}
        </p>

        <h1 className={styles.srOnly} data-testid="tenant-name">
          {businessName}
        </h1>

        {/* Pastilla del nivel actual, como en su carta: "Menu" en la raíz y, dentro de una
            categoría, su nombre precedido de la flecha de vuelta. */}
        <nav className={styles.nav} data-testid="breadcrumb">
          {view.currentName ? (
            <a className={styles.back} href={view.rootHref}>
              <span aria-hidden="true">‹</span> {view.currentName}
            </a>
          ) : (
            <span className={styles.back}>{t.menuTitle}</span>
          )}
          {view.breadcrumb.length > 0 ? (
            <p className={styles.crumbs}>
              {view.breadcrumb.map((crumb) => (
                <a key={crumb.href} href={crumb.href}>
                  {crumb.name}
                </a>
              ))}
            </p>
          ) : null}
        </nav>

        {view.children.length > 0 ? (
          <ul className={styles.grid}>
            {view.children.map((node) => (
              <li key={node.id} data-testid="category">
                <a className={styles.card} href={node.href}>
                  {/* Su carta usa una FOTO por categoría; el emoji queda de respaldo cuando no
                    la hay. aria-hidden en ambos: el nombre de al lado ya dice qué es, y sin
                    esto un lector de pantalla anunciaría "taza de café Cafés". */}
                  {node.imageUrl ? (
                    <Image
                      className={styles.cardPhoto}
                      src={node.imageUrl}
                      alt=""
                      aria-hidden
                      width={200}
                      height={200}
                      unoptimized
                    />
                  ) : node.icon ? (
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
                {/* Su tarjeta real: la foto arriba con el precio en una pastilla encima, y
                    debajo el nombre y el botón a todo el ancho. Foto de Storage ya optimizada
                    al subir, por eso `unoptimized`; `fill` la ajusta a la franja. */}
                <div className={styles.itemMedia}>
                  {product.imageUrl ? (
                    <Image
                      className={styles.itemPhoto}
                      data-testid="product-photo"
                      src={product.imageUrl}
                      alt=""
                      fill
                      sizes="(min-width: 48rem) 33vw, 50vw"
                      unoptimized
                    />
                  ) : null}
                  <span className={styles.price}>{product.priceLabel}</span>
                  <div className={styles.itemAllergens}>
                    <AllergenBadges allergens={product.allergens} />
                  </div>
                </div>
                <div className={styles.itemBody}>
                  <span className={styles.itemName}>{product.name}</span>
                  <AddToCart product={product} />
                </div>
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
