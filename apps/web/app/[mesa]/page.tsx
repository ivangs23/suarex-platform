import { parseBranding } from "@suarex/config";
import { getCategories, getProducts, getTenantSettings } from "@suarex/db";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";

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
  const businessName = parseBranding(settings?.branding).name ?? tenant.slug;

  return (
    <main>
      <h1 data-testid="tenant-name">{businessName}</h1>
      <p data-testid="mesa">Mesa {mesa}</p>
      {/* Cuenta cruda de getProducts(tenant.id), sin filtrar por categoría:
          si el filtro tenant_id de getProducts se perdiera, este número
          cambiaría aunque ningún producto huérfano se renderizase abajo
          (el filtrado por category_id ya oculta huérfanos de la vista). */}
      <p data-testid="product-count" hidden>
        {products.length}
      </p>

      {categories.map((category) => (
        <section key={category.id} data-testid="category">
          <h2>{category.nameI18n.es}</h2>
          <ul>
            {products
              .filter((product) => product.categoryId === category.id)
              .map((product) => (
                <li key={product.id} data-testid="product">
                  {product.nameI18n.es} — {product.price.toFixed(2)} €
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
