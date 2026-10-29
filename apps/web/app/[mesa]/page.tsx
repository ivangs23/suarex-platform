import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { type QueryDeLaCarta, renderCarta } from "./Carta";

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

/** Carta de una mesa: la del QR impreso, la única que puede pedir. El render es `renderCarta`. */
export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ mesa: string }>;
  searchParams: Promise<QueryDeLaCarta>;
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

  return renderCarta({ tenant, mesa, query });
}
