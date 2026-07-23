import { parseBranding } from "@suarex/config";
import { findTableByToken, getCategories, getProducts, getTenantSettings } from "@suarex/db";
import { notFound } from "next/navigation";
import { readMesaToken } from "@/lib/mesa-cookie";
import { requireTenant } from "@/lib/tenant-context";
import { CartBar } from "./cart/CartBar";
import { CartProvider } from "./cart/CartProvider";
import { buildMenuView } from "./menu-view";
import { resolveTheme } from "./themes";

// Los identificadores de mesa son siempre numéricos (ver el diseño: canal
// "QR en mesa" -> `/{mesa}`). Este catch-all de un solo segmento también
// captura cualquier otra petición de un solo segmento que no tenga su propia
// ruta estática: `favicon.ico` (excluido del matcher de proxy.ts a propósito,
// así que NUNCA lleva cabeceras de tenant, incluso en un host válido),
// `robots.txt`, `apple-touch-icon.png`, escaneos de bots, etc. Sin esta
// validación, esas peticiones llegaban a `requireTenant()` sin cabeceras
// (favicon.ico) -> throw sin capturar -> 500 en cada sitio de cada tenant; o,
// con cabeceras (robots.txt en un host válido), renderizaban la carta entera
// de un tenant real para una ruta que no es una mesa. Cualquier segmento no
// numérico se resuelve aquí como 404 limpio, antes de tocar el tenant.
const MESA_PATTERN = /^\d+$/;

/**
 * Carta pública de una mesa. Esta página hace UNA sola carga de datos y delega toda la
 * presentación al tema del tenant (`tenant_settings.theme`, resuelto por `resolveTheme`):
 * `generic` se pinta con el branding, y los temas a medida (garum, manuela) son componentes
 * codificados. Añadir un tema no toca este fichero -- todos consumen el mismo contrato
 * `MenuThemeProps`.
 *
 * La carta se navega por NIVELES: `?cat=<slug>` elige el nodo del árbol de categorías y
 * `buildMenuView` resuelve qué pintar (hijos, productos y rastro de vuelta). Sin `cat` se
 * está en la raíz. Es un enlace normal, no estado de cliente: la carta sigue siendo
 * server-only y compartible/atrás-adelante sin JS.
 */
export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ mesa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ mesa }, query] = await Promise.all([params, searchParams]);

  if (!MESA_PATTERN.test(mesa)) {
    notFound();
  }

  // Defensa en profundidad: si esta ruta numérica llegara alguna vez sin
  // cabeceras de tenant (no debería pasar dado el contrato de proxy.ts), un
  // tenant no resuelto aquí degrada a 404 limpio en vez de un throw sin
  // capturar -- el mismo patrón que ya usa layout.tsx para /not-found y
  // /suspended, aplicado aquí solo a esta única causa de fallo documentada en
  // tenant-context.ts, no a cualquier error.
  const tenant = await requireTenant().catch(() => null);
  if (!tenant) {
    notFound();
  }

  const [categories, products, settings] = await Promise.all([
    getCategories(tenant.id),
    getProducts(tenant.id),
    getTenantSettings(tenant.id).catch(() => null),
  ]);

  const branding = parseBranding(settings?.branding);
  const businessName = branding.name ?? tenant.slug;

  // `?cat=a&cat=b` (repetido) llega como array; nos quedamos con el primero. Un slug
  // desconocido no es un error: `buildMenuView` degrada a la raíz.
  const rawCat = query.cat;
  const currentSlug = (Array.isArray(rawCat) ? rawCat[0] : rawCat) ?? null;

  const view = buildMenuView({
    categories,
    products,
    currentSlug,
    basePath: `/${mesa}`,
    locale: settings?.locale,
    currency: settings?.currency,
    // El bucket `catalog` es público en lectura (20260722000007_catalog_storage.sql), así
    // que basta el endpoint público; NEXT_PUBLIC_* se inlinea en build y no expone ninguna
    // clave de servicio.
    storageOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  // Paso de bienvenida: activo solo en la raíz de la carta y mientras no se haya entrado.
  // Es la página quien lo calcula y el tema quien decide si lo usa (ver `MenuThemeProps`).
  const entrado = (Array.isArray(query.ver) ? query.ver[0] : query.ver) === "carta";
  const welcome = {
    active: !entrado && currentSlug === null,
    href: `/${mesa}?ver=carta`,
  };

  // PEDIR EXIGE HABER ESCANEADO EL QR DE ESTA MESA. La cookie la fija `/m/{token}` (ver
  // `lib/mesa-cookie.ts`) y aquí se comprueba que la mesa que designa es de ESTE cliente y
  // es ESTA mesa: sin las dos comprobaciones, una cookie de otro restaurante -- o de la mesa
  // 3 mientras se mira la carta de la 7 -- serviría para mandar comandas a donde no toca.
  // Quien llega a `/{mesa}` sin escanear ve la carta igual, pero en consulta.
  const mesaToken = await readMesaToken();
  const mesaEscaneada = mesaToken ? await findTableByToken(mesaToken).catch(() => null) : null;
  const canOrder =
    mesaEscaneada?.isActive === true &&
    mesaEscaneada.tenantId === tenant.id &&
    mesaEscaneada.label === mesa;

  const Theme = resolveTheme(settings?.theme);

  /* El carrito envuelve al tema y la barra de total la pinta la página, no el tema: es lo
     último que ve el comensal antes de pagar, y un tema al que se le olvidara pintarla
     dejaría a ese cliente con una carta que no cobra. */
  return (
    <CartProvider
      locale={settings?.locale ?? "es"}
      currency={settings?.currency ?? "EUR"}
      canOrder={canOrder}
    >
      <Theme
        tenantSlug={tenant.slug}
        businessName={businessName}
        mesa={mesa}
        branding={branding}
        view={view}
        welcome={welcome}
      />
      <CartBar />
    </CartProvider>
  );
}
