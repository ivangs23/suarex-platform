import { hasChannel, parseBranding } from "@suarex/config";
import { findTableByToken } from "@suarex/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fichaDeLaCarta, leerCarta, settingsDeLaCarta } from "@/lib/carta-cache";
import { availableLangs, LANG_LABELS, resolveLang, strings } from "@/lib/i18n";
import { jsonLdDeLaCarta, jsonLdEnTexto } from "@/lib/json-ld";
import { readMesaToken } from "@/lib/mesa-cookie";
import { metadatosDeLaCarta } from "@/lib/metadatos";
import { origenPublicoDeLaPeticion } from "@/lib/origen-publico-peticion";
import type { ResolvedTenant } from "@/lib/tenant-context";
import { CartPanelHost } from "./cart/CartPanelHost";
import { CartProvider } from "./cart/CartProvider";
import { ScanToOrderHint } from "./cart/ScanToOrderHint";
import { FichaDelLocal } from "./FichaDelLocal";
import { LegalFooter } from "./LegalFooter";
import { buildMenuView, type MenuView } from "./menu-view";
import { resolveTheme } from "./themes";

export type QueryDeLaCarta = Record<string, string | string[] | undefined>;

type EntradaDeLaCarta = { tenant: ResolvedTenant; mesa: string | null; query: QueryDeLaCarta };

/** Lo que la carta carga y resuelve: lo comparten el render y sus metadatos. */
async function prepararCarta({ tenant, mesa, query }: EntradaDeLaCarta) {
  // Cacheados por tenant (`lib/carta-cache.ts`); las franjas y el agotado se aplican aquí, a
  // la hora de esta petición. Si los alérgenos fallaran, la carta revienta en vez de decir
  // "sin alérgenos" sobre un plato con gluten. Sin ficha, en cambio, la carta se sirve igual.
  const [{ categories, products, allergens }, settings, ficha] = await Promise.all([
    leerCarta(tenant.id),
    settingsDeLaCarta(tenant.id).catch(() => null),
    fichaDeLaCarta(tenant.id).catch(() => null),
  ]);

  // Mismo criterio que el totem: sin el canal encendido, este cliente no sirve carta por QR.
  if (!hasChannel(settings?.channels ?? [], "qr-mesa")) {
    notFound();
  }

  const branding = parseBranding(settings?.branding);
  const businessName = branding.name ?? tenant.slug;
  const basePath = mesa === null ? "/" : `/${mesa}`;

  // `?cat=a&cat=b` (repetido) llega como array; nos quedamos con el primero. Un slug
  // desconocido no es un error: `buildMenuView` degrada a la raíz.
  const rawCat = query.cat;
  const currentSlug = (Array.isArray(rawCat) ? rawCat[0] : rawCat) ?? null;

  // IDIOMA. Sale de la URL, con el del cliente como partida; uno desconocido o manipulado
  // cae a ese mismo en vez de romper la carta.
  const rawLang = Array.isArray(query.lang) ? query.lang[0] : query.lang;
  const porDefecto = resolveLang(undefined, settings?.locale);
  const lang = resolveLang(rawLang, settings?.locale);

  // Los idiomas OFRECIDOS salen de los datos del cliente, no de un ajuste: enseñar "EN" para
  // acabar sirviendo la carta en español sería peor que no ofrecerlo.
  const idiomas = availableLangs(
    [...categories.map((c) => c.nameI18n), ...products.map((p) => p.nameI18n)],
    porDefecto,
  );

  const view = buildMenuView({
    categories,
    products,
    currentSlug,
    basePath,
    locale: settings?.locale,
    currency: settings?.currency,
    // El bucket `catalog` es público en lectura (20260722000007_catalog_storage.sql), así
    // que basta el endpoint público; NEXT_PUBLIC_* se inlinea en build y no expone ninguna
    // clave de servicio.
    storageOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL,
    allergens,
    lang,
  });

  return {
    settings,
    branding,
    businessName,
    basePath,
    currentSlug,
    lang,
    porDefecto,
    idiomas,
    view,
    ficha,
  };
}

/** La categoría que se ve, ya resuelta: un slug desconocido cae a la raíz y no cuenta. */
function categoriaActual(currentSlug: string | null, view: MenuView) {
  return currentSlug && view.currentName ? { slug: currentSlug, nombre: view.currentName } : null;
}

/** Título, canonical y vista previa de la carta: solo con lo que la página pinta. */
export async function metadatosDeLaPagina(entrada: EntradaDeLaCarta): Promise<Metadata> {
  const [carta, { origen }] = await Promise.all([
    prepararCarta(entrada),
    origenPublicoDeLaPeticion(entrada.tenant.id),
  ]);
  const { branding, currentSlug, lang, view } = carta;
  return metadatosDeLaCarta({
    businessName: carta.businessName,
    // Mismo criterio que el tema: el lema es por idioma y, sin traducción, no hay.
    tagline: branding.tagline[lang] ?? null,
    lang,
    porDefecto: carta.porDefecto,
    idiomas: carta.idiomas,
    categoria: categoriaActual(currentSlug, view),
    origen,
    heroUrl: branding.heroUrl,
  });
}

/**
 * La carta pública, con dos entradas sobre este mismo render: `/{mesa}` (la del QR, que puede
 * pedir) y `/` (consulta, sin mesa). Ver docs/decisions/0009-carta-publica-en-la-raiz.md.
 *
 * Hace UNA sola carga de datos y delega toda la presentación al tema del tenant
 * (`tenant_settings.theme`, resuelto por `resolveTheme`): hoy solo `generic`, que se pinta
 * entero con el branding del cliente. Todo tema consume el mismo contrato `MenuThemeProps`.
 *
 * La carta se navega por NIVELES: `?cat=<slug>` elige el nodo del árbol de categorías y
 * `buildMenuView` resuelve qué pintar (hijos, productos y rastro de vuelta). Sin `cat` se
 * está en la raíz. Es un enlace normal, no estado de cliente: la carta sigue siendo
 * server-only y compartible/atrás-adelante sin JS.
 */
export async function renderCarta(entrada: EntradaDeLaCarta) {
  const { tenant, mesa, query } = entrada;
  const {
    settings,
    branding,
    businessName,
    basePath,
    currentSlug,
    lang,
    porDefecto,
    idiomas,
    view,
    ficha,
  } = await prepararCarta(entrada);

  // Paso de bienvenida: activo solo en la raíz de la carta y mientras no se haya entrado.
  // Es la página quien lo calcula y el tema quien decide si lo usa (ver `MenuThemeProps`).
  const entrado = (Array.isArray(query.ver) ? query.ver[0] : query.ver) === "carta";
  const langQuery = lang === porDefecto ? "" : `&lang=${lang}`;
  const welcome = {
    active: !entrado && currentSlug === null,
    href: `${basePath}?ver=carta${langQuery}`,
  };

  /* Cambiar de idioma conserva DÓNDE estabas: se reconstruye la misma URL con otro `lang`.
     Mandar a la raíz al cambiar obligaría a rehacer toda la navegación, que es justo lo que
     hace que nadie use el selector. */
  const langs = idiomas.map((code) => {
    const partes = [
      currentSlug ? `cat=${encodeURIComponent(currentSlug)}` : null,
      entrado || currentSlug ? "ver=carta" : null,
      code === porDefecto ? null : `lang=${code}`,
    ].filter(Boolean);
    return {
      code,
      label: LANG_LABELS[code],
      href: partes.length > 0 ? `${basePath}?${partes.join("&")}` : basePath,
      active: code === lang,
    };
  });

  const [canOrder, { origen }] = await Promise.all([
    // Sin mesa no hay nada que comprobar: la carta de `/` es de consulta.
    mesa !== null && puedePedirEnLaMesa(tenant.id, mesa),
    origenPublicoDeLaPeticion(tenant.id),
  ]);

  // Datos estructurados: exactamente lo que esta página enseña (`lib/json-ld.ts`).
  const jsonLd = jsonLdDeLaCarta({
    businessName,
    tagline: branding.tagline[lang] ?? null,
    origen,
    ficha,
    idioma: lang === porDefecto ? null : lang,
    currency: settings?.currency ?? "EUR",
    bienvenida: welcome.active,
    categoria: categoriaActual(currentSlug, view),
    secciones: view.children,
    platos: view.products,
  });

  const Theme = resolveTheme(settings?.theme);

  /* El carrito envuelve al tema. El PANEL lo monta la página (es el paso del dinero, y un
     tema que se lo saltara dejaría a ese cliente sin forma de pagar); el BOTÓN que lo abre lo
     coloca cada tema donde encaje en su diseño. */
  return (
    <CartProvider
      locale={settings?.locale ?? "es"}
      currency={settings?.currency ?? "EUR"}
      canOrder={canOrder}
      strings={strings(lang)}
    >
      <Theme
        tenantSlug={tenant.slug}
        businessName={businessName}
        mesa={mesa ?? ""}
        branding={branding}
        view={view}
        welcome={welcome}
        langs={langs}
        strings={strings(lang)}
      />
      <CartPanelHost />
      <ScanToOrderHint />
      <FichaDelLocal ficha={ficha} lang={lang} strings={strings(lang)} />
      {/* Lo monta la PÁGINA, no el tema: igual que CartPanelHost. Un tema decide cómo se ve
          la carta; nunca si el comensal puede llegar a la política de privacidad de su
          restaurante. Por eso no está en contract.test.tsx -- ese helper solo renderiza el
          tema, así que no podría verlo. Lo cubre tests/e2e/legal.spec.ts. */}
      <LegalFooter strings={strings(lang)} />
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: `jsonLdEnTexto` escapa `<` como <, así que ningún texto del cliente puede cerrar el script.
        dangerouslySetInnerHTML={{ __html: jsonLdEnTexto(jsonLd) }}
      />
    </CartProvider>
  );
}

/**
 * PEDIR EXIGE HABER ESCANEADO EL QR DE ESTA MESA. La cookie la fija `/m/{token}` (ver
 * `lib/mesa-cookie.ts`) y aquí se comprueba que la mesa que designa es de ESTE cliente y es
 * ESTA mesa: sin las dos comprobaciones, una cookie de otro restaurante -- o de la mesa 3
 * mientras se mira la carta de la 7 -- serviría para mandar comandas a donde no toca. Quien
 * llega a `/{mesa}` sin escanear ve la carta igual, pero en consulta.
 */
async function puedePedirEnLaMesa(tenantId: string, mesa: string): Promise<boolean> {
  const mesaToken = await readMesaToken();
  const mesaEscaneada = mesaToken ? await findTableByToken(mesaToken).catch(() => null) : null;
  return (
    mesaEscaneada?.isActive === true &&
    mesaEscaneada.tenantId === tenantId &&
    mesaEscaneada.label === mesa
  );
}
