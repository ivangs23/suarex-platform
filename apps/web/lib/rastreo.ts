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
 * La carta sin mesa, una URL por categoría con algo que ver y las páginas legales. Las
 * categorías y productos son los de `leerCarta`, los mismos que ve el comensal ahora: una
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
  const conProductos = new Set(productos.map((p) => p.categoryId));
  const hijos = new Map<string, string[]>();
  for (const c of categorias) {
    if (c.parentId) hijos.set(c.parentId, [...(hijos.get(c.parentId) ?? []), c.id]);
  }

  // Un ciclo de `parent_id` (nada en la base lo impide) no puede colgar el sitemap.
  const visitando = new Set<string>();
  const tieneProductos = (id: string): boolean => {
    if (conProductos.has(id)) return true;
    if (visitando.has(id)) return false;
    visitando.add(id);
    const alguno = (hijos.get(id) ?? []).some(tieneProductos);
    visitando.delete(id);
    return alguno;
  };

  return [
    { url: urlDeLaCarta(origen, null, null) },
    ...categorias
      .filter((c) => tieneProductos(c.id))
      .map((c) => ({ url: urlDeLaCarta(origen, c.slug, null) })),
    ...DOCUMENTOS_LEGALES.map((documento) => ({ url: `${origen}/legal/${documento}` })),
  ];
}
