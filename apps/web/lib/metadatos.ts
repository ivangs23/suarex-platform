import type { Metadata } from "next";
import { type Lang, strings } from "./i18n";

/** Lo que la carta ya tiene cargado y se ve en la página. Nada más entra en los metadatos. */
export type DatosDeLaCarta = {
  businessName: string;
  /** El lema en el idioma de la página, o `null`: sin lema no hay descripción. */
  tagline: string | null;
  lang: Lang;
  /** El idioma del cliente: su URL no lleva `?lang=`. */
  porDefecto: Lang;
  /** Los idiomas en los que el cliente TIENE carta (`availableLangs`). */
  idiomas: readonly Lang[];
  /** La categoría que se está viendo, ya resuelta: un slug desconocido llega como `null`. */
  categoria: { slug: string; nombre: string } | null;
  origen: string;
  heroUrl: string | null;
};

/**
 * La URL pública de un nivel de la carta: la raíz o una categoría, nunca una mesa (30 mesas no
 * son 30 cartas). Es la del canonical y la del sitemap. `idioma` solo cuando no es el del
 * cliente, igual que los enlaces de la página.
 */
export function urlDeLaCarta(origen: string, slug: string | null, idioma: Lang | null): string {
  const params = new URLSearchParams();
  if (slug) params.set("cat", slug);
  if (idioma) params.set("lang", idioma);
  const query = params.toString();
  return `${origen}/${query ? `?${query}` : ""}`;
}

/** Las vistas previas exigen URL absoluta; una ruta de `public/` se resuelve en el origen. */
function absoluta(url: string, origen: string): string | null {
  try {
    return new URL(url, `${origen}/`).toString();
  } catch {
    return null;
  }
}

/** Título, descripción, canonical, idiomas y vista previa de la carta (`/` y `/{mesa}`). */
export function metadatosDeLaCarta(d: DatosDeLaCarta): Metadata {
  const titulo = d.categoria
    ? `${d.categoria.nombre} · ${d.businessName}`
    : `${d.businessName} · ${strings(d.lang).cartaTitle}`;
  const slug = d.categoria?.slug ?? null;
  const idioma = (code: Lang) => (code === d.porDefecto ? null : code);
  const canonical = urlDeLaCarta(d.origen, slug, idioma(d.lang));
  const descripcion = d.tagline ? { description: d.tagline } : {};
  const imagen = d.heroUrl ? absoluta(d.heroUrl, d.origen) : null;

  return {
    // `absolute`: la plantilla del layout («%s · {nombre}») repetiría el nombre.
    title: { absolute: titulo },
    ...descripcion,
    alternates: {
      canonical,
      ...(d.idiomas.length > 1
        ? {
            languages: Object.fromEntries(
              d.idiomas.map((code) => [code, urlDeLaCarta(d.origen, slug, idioma(code))]),
            ),
          }
        : {}),
    },
    openGraph: {
      title: titulo,
      ...descripcion,
      url: canonical,
      type: "website",
      ...(imagen ? { images: [imagen] } : {}),
    },
  };
}
