import { parseBranding } from "@suarex/config";
import { getCategories, getProducts, getTenantSettings } from "@suarex/db";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import type { ThemeCategory } from "./themes";
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
 */
export default async function MenuPage({ params }: { params: Promise<{ mesa: string }> }) {
  const { mesa } = await params;

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

  // El catálogo se aplana al contrato del tema: categorías con sus productos ya anidados,
  // resueltos al idioma por defecto. Un tema nunca vuelve a consultar la base.
  const themeCategories: ThemeCategory[] = categories.map((category) => ({
    id: category.id,
    name: category.nameI18n.es ?? category.slug,
    products: products
      .filter((product) => product.categoryId === category.id)
      .map((product) => ({
        id: product.id,
        name: product.nameI18n.es ?? "",
        price: product.price,
      })),
  }));

  const Theme = resolveTheme(settings?.theme);

  return (
    <Theme
      tenantSlug={tenant.slug}
      businessName={businessName}
      mesa={mesa}
      branding={branding}
      categories={themeCategories}
      // Cuenta cruda de getProducts(tenant.id), sin filtrar por categoría: si el filtro
      // tenant_id de getProducts se perdiera, este número cambiaría aunque ningún producto
      // huérfano se renderizase (el filtrado por category_id ya oculta huérfanos de la vista).
      productCount={products.length}
    />
  );
}
