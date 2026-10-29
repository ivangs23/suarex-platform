import type { MetadataRoute } from "next";
import { DOCUMENTOS_LEGALES } from "./legal-content";
import { urlDeLaCarta } from "./metadatos";

/** Lo que nunca debe indexarse en el host de un cliente. `/m/` lleva el token de la mesa. */
const PRIVADO = ["/admin", "/staff", "/api/", "/pedido/", "/m/", "/totem/"];

/**
 * `robots.txt` de un host: con origen, el de un cliente; sin él, el de plataforma, que no tiene
 * nada que indexar. Los rastreadores de asistentes siguen la regla general: bloquearlos sería
 * una decisión de plataforma, no de cada cliente.
 */
export function reglasDeRobots(origen: string | null): MetadataRoute.Robots {
  if (origen === null) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVADO },
    sitemap: `${origen}/sitemap.xml`,
  };
}

type Categoria = { id: string; slug: string; parentId: string | null };

/**
 * Platos de cada categoría contando su subárbol, como el recuento de la carta. Las categorías y
 * productos son los de `leerCarta`, los que ve el comensal ahora.
 */
export function platosPorCategoria(
  categorias: readonly Categoria[],
  productos: readonly { categoryId: string }[],
): Map<string, number> {
  const propios = new Map<string, number>();
  for (const p of productos) propios.set(p.categoryId, (propios.get(p.categoryId) ?? 0) + 1);
  const hijos = new Map<string, string[]>();
  for (const c of categorias) {
    if (c.parentId) hijos.set(c.parentId, [...(hijos.get(c.parentId) ?? []), c.id]);
  }

  // Un ciclo de `parent_id` (nada en la base lo impide) no puede colgar el recuento.
  const total = new Map<string, number>();
  const visitando = new Set<string>();
  const contar = (id: string): number => {
    const hecho = total.get(id);
    if (hecho !== undefined) return hecho;
    if (visitando.has(id)) return 0;
    visitando.add(id);
    const n = (propios.get(id) ?? 0) + (hijos.get(id) ?? []).reduce((s, h) => s + contar(h), 0);
    visitando.delete(id);
    total.set(id, n);
    return n;
  };
  for (const c of categorias) contar(c.id);
  return total;
}

/**
 * La carta sin mesa, una URL por categoría con algo que ver y las páginas legales. Una
 * categoría vacía también lo está en la carta.
 */
export function urlsDelSitemap({
  origen,
  categorias,
  productos,
}: {
  origen: string;
  categorias: readonly Categoria[];
  productos: readonly { categoryId: string }[];
}): MetadataRoute.Sitemap {
  const platos = platosPorCategoria(categorias, productos);
  return [
    { url: urlDeLaCarta(origen, null, null) },
    ...categorias
      .filter((c) => (platos.get(c.id) ?? 0) > 0)
      .map((c) => ({ url: urlDeLaCarta(origen, c.slug, null) })),
    ...DOCUMENTOS_LEGALES.map((documento) => ({ url: `${origen}/legal/${documento}` })),
  ];
}
