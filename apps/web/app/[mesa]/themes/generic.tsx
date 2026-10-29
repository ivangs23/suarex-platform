import Image from "next/image";
import type { CSSProperties } from "react";
import { AllergenBadges } from "../allergens/AllergenBadges";
import { AddToCart } from "../cart/AddToCart";
import { CartButton } from "../cart/CartButton";
import styles from "./generic.module.css";
import type { MenuLang, MenuTheme } from "./types";

/**
 * LA CARTA, la misma para todos los clientes.
 *
 * Lo que cambia de uno a otro es DATO (`tenant_settings.branding`, ver `@suarex/config`):
 * - los colores, las fuentes y los tokens de estilo llegan como variables CSS del layout raíz;
 * - los seis ejes de layout (`branding.layout`) van como `data-layout-*` en el contenedor, y el
 *   CSS cuelga de ellos. Ningún eje decide QUÉ pasos hay -- bienvenida, ficha, botón de pedido,
 *   conteo, alérgenos, selector de idioma --, solo dónde y cómo se pintan;
 * - el contenido: logo, foto de bienvenida, textura, lema e insignia.
 *
 * Así, dar de alta un cliente con aspecto propio es rellenar su panel de ajustes, no escribir
 * un tema. `contract.test.tsx` recorre TODAS las combinaciones de ejes.
 *
 * Los `data-testid` (`tenant-name`, `mesa`, `product-count`, `category`, `product`) son contrato
 * con la suite e2e.
 */

/* Banderas del eje `langs=flag`. Decoración (`aria-hidden`): una bandera no identifica un
   idioma -- el portugués de Brasil no lleva la de Portugal --, así que manda el código. */
const LANG_FLAGS: Record<string, string> = { es: "🇪🇸", en: "🇬🇧", pt: "🇵🇹" };

/** La bienvenida: la misma ruta que la entrada a la carta, sin el `ver=carta`. */
function inicioDe(entrarHref: string): string {
  const url = new URL(entrarHref, "http://carta.local");
  url.searchParams.delete("ver");
  return `${url.pathname}${url.search}`;
}

function Langs({ langs }: { langs: MenuLang[] }) {
  if (langs.length <= 1) return null;
  return (
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
            <span className={styles.langFlag} aria-hidden="true">
              {LANG_FLAGS[lang.code]}
            </span>
          ) : null}
          {lang.label}
        </a>
      ))}
    </nav>
  );
}

export const GenericTheme: MenuTheme = ({
  businessName,
  mesa,
  branding,
  view,
  welcome,
  langs,
  strings: t,
}) => {
  const { layout, tokens, background, badge } = branding;
  const idioma = langs.find((lang) => lang.active)?.code ?? "es";
  // El lema es contenido por idioma: sin traducción a este idioma, no se pinta.
  const tagline = branding.tagline[idioma] ?? null;

  const raiz = {
    className: styles.page,
    "data-theme": "generic",
    "data-layout-welcome": layout.welcome,
    "data-layout-hero": layout.hero,
    "data-layout-nav": layout.nav,
    "data-layout-categories": layout.categories,
    "data-layout-products": layout.products,
    "data-layout-langs": layout.langs,
    "data-surface": tokens.surface ? "custom" : "auto",
    "data-spacing": tokens.spacing,
    "data-controls": tokens.controlRadius,
    "data-border": tokens.border,
    "data-titles": tokens.titles,
    "data-cart-icon": tokens.cartIcon,
    "data-textured": background.imageUrl ? "true" : undefined,
    // La textura va aquí y no en las variables del layout: lleva una URL, y aquel bloque se
    // inyecta en un <style>. La URL ya la validó `parseBranding` (http/https o /brands/).
    style: background.imageUrl
      ? ({
          backgroundImage: `url(${JSON.stringify(background.imageUrl)})`,
          backgroundSize: `${background.sizePx}px auto`,
        } satisfies CSSProperties)
      : undefined,
  };

  /* PANTALLA DE BIENVENIDA: un paso del flujo, así que la tienen TODOS los clientes. Lo que
     cambia es cómo se ve (`layout.welcome`) y la foto, que es un ajuste del cliente. */
  if (welcome.active) {
    return (
      <main {...raiz}>
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
              priority
            />
          ) : null}
          {/* `div` y no `span`: dentro va el `h1`, y un encabezado no cabe en un `span`. */}
          <div className={styles.welcomeContent}>
            {branding.logoUrl ? (
              <Image
                className={styles.welcomeLogo}
                src={branding.logoUrl}
                alt=""
                aria-hidden
                width={200}
                height={200}
                unoptimized
                priority
              />
            ) : null}
            {layout.welcome === "poster" && badge ? (
              <span
                className={styles.badge}
                style={{ backgroundColor: badge.color }}
                aria-hidden="true"
              >
                {badge.emoji}
              </span>
            ) : null}
            <h1 className={styles.name} data-testid="tenant-name">
              {businessName}
            </h1>
            {tagline ? <span className={styles.tagline}>{tagline}</span> : null}
            {/* Sin mesa (canal totem) no se pinta: en la mesa (QR) siempre hay número. */}
            {mesa ? (
              <span className={styles.mesa} data-testid="mesa">
                {t.table} {mesa}
              </span>
            ) : null}
            <span className={styles.enter}>{t.enter}</span>
          </div>
        </a>
        <Langs langs={langs} />
      </main>
    );
  }

  return (
    <main {...raiz}>
      {/* Cabecera en TRES zonas, en todos los clientes: la mesa a un lado, la marca centrada (y
          enlazada a la bienvenida) y a la derecha los idiomas con la bolsa del pedido. */}
      <header className={styles.topbar}>
        {/* Sin mesa (totem) la columna queda vacía y la marca sigue centrada. */}
        {mesa ? (
          <span className={styles.mesa} data-testid="mesa">
            {t.table} {mesa}
          </span>
        ) : (
          <span />
        )}

        <a className={styles.brand} href={inicioDe(welcome.href)} aria-label={t.backToStart}>
          {branding.logoUrl ? (
            <Image
              className={styles.topbarLogo}
              src={branding.logoUrl}
              alt={businessName}
              width={200}
              height={200}
              unoptimized
              // Siempre en la primera pantalla: con lazy-load el navegador lo pide tarde.
              loading="eager"
            />
          ) : (
            <span className={styles.topbarName}>{businessName}</span>
          )}
        </a>

        <div className={styles.topbarEnd}>
          <Langs langs={langs} />
          <CartButton className={styles.cartButton} />
        </div>
      </header>

      <div className={styles.inner}>
        {layout.hero === "none" ? (
          // Sin cabecera el nombre ya lo dice el logo; queda para lectores de pantalla.
          <h1 className={styles.srOnly} data-testid="tenant-name">
            {businessName}
          </h1>
        ) : (
          <section className={styles.hero}>
            <h1 className={styles.name} data-testid="tenant-name">
              {businessName}
            </h1>
            {tagline ? <p className={styles.tagline}>{tagline}</p> : null}
          </section>
        )}

        <p data-testid="product-count" hidden>
          {view.totalProducts}
        </p>

        {layout.nav === "title-pill" ? (
          /* Píldora del nivel actual: "Menú" en la raíz y, dentro, su nombre con la flecha de
             vuelta. */
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
        ) : view.currentName ? (
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
        ) : layout.hero === "plain" ? (
          <p className={styles.lead}>{t.explore}</p>
        ) : null}

        {view.children.length > 0 ? (
          <ul className={styles.grid}>
            {view.children.map((node) => (
              <li key={node.id} data-testid="category">
                <a className={styles.card} href={node.href}>
                  {/* aria-hidden en foto e icono: el nombre de al lado ya dice qué es. Sin esto
                      un lector de pantalla anuncia "copa de vino Vinos". */}
                  {layout.categories === "photo-tiles" && node.imageUrl ? (
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
            {view.products.map((product) =>
              layout.products === "cards" ? (
                <li key={product.id} className={styles.item} data-testid="product">
                  {/* Foto arriba con el precio y los alérgenos encima; debajo el nombre y el
                      botón. La franja existe aunque no haya foto, para que la rejilla no quede
                      dentada. */}
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
              ) : (
                <li key={product.id} className={styles.item} data-testid="product">
                  <div className={styles.itemText}>
                    <span className={styles.itemName}>{product.name}</span>
                    <span className={styles.price}>{product.priceLabel}</span>
                    <AllergenBadges allergens={product.allergens} />
                  </div>
                  {/* Foto de Storage, ya optimizada al subirla (900px WebP): `unoptimized` evita
                      re-optimizarla en el VPS y conserva el lazy-load y las dimensiones. */}
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
              ),
            )}
          </ul>
        ) : null}

        {view.children.length === 0 && view.products.length === 0 ? (
          <p className={styles.empty}>{t.emptyMenu}</p>
        ) : null}
      </div>
    </main>
  );
};
