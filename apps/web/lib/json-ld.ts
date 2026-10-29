import { DIAS_DE_LA_SEMANA, type DiaDeLaSemana, type FichaPublica, type Horario } from "@suarex/db";
import type { Lang } from "./i18n";
import { urlDeLaCarta } from "./metadatos";

/**
 * Lo que la página enseña, y nada más (sin valoraciones, sin rango de precios, sin país): la
 * ficha que el cliente guardó y el nivel de la carta que se ve. Las secciones y platos son los
 * de `buildMenuView`, ya filtrados por franja y agotado, igual que los ve el comensal.
 */
export type DatosJsonLd = {
  businessName: string;
  tagline: string | null;
  origen: string;
  ficha: FichaPublica | null;
  /** `null` en el idioma del cliente: sus URL no llevan `?lang=`. */
  idioma: Lang | null;
  currency: string;
  /** La bienvenida no enseña la carta: solo enlaza a ella. */
  bienvenida: boolean;
  categoria: { slug: string; nombre: string } | null;
  secciones: readonly { slug: string; name: string; productCount: number }[];
  platos: readonly { name: string; price: number }[];
};

const DIA_SCHEMA: Record<DiaDeLaSemana, string> = {
  mo: "Monday",
  tu: "Tuesday",
  we: "Wednesday",
  th: "Thursday",
  fr: "Friday",
  sa: "Saturday",
  su: "Sunday",
};

const tramoJsonLd = (dia: DiaDeLaSemana, opens: string, closes: string) => ({
  "@type": "OpeningHoursSpecification",
  dayOfWeek: DIA_SCHEMA[dia],
  opens,
  closes,
});

/** Un día cerrado (`[]`) no se declara. Un tramo que pasa de medianoche se parte en dos días. */
function horarioJsonLd(horario: Horario) {
  return DIAS_DE_LA_SEMANA.flatMap((dia, i) =>
    (horario[dia] ?? []).flatMap(([desde, hasta]) => {
      if (hasta > desde) return [tramoJsonLd(dia, desde, hasta)];
      const siguiente = DIAS_DE_LA_SEMANA[(i + 1) % 7] as DiaDeLaSemana;
      return [tramoJsonLd(dia, desde, "23:59"), tramoJsonLd(siguiente, "00:00", hasta)];
    }),
  );
}

function direccionJsonLd(f: FichaPublica) {
  const campos = Object.entries({
    streetAddress: f.street,
    postalCode: f.postalCode,
    addressLocality: f.city,
    addressRegion: f.region,
  }).filter(([, valor]) => valor);
  return campos.length > 0 ? { "@type": "PostalAddress", ...Object.fromEntries(campos) } : null;
}

/** Solo las claves con valor: un dato que falta se omite, no se publica vacío. */
function compacto(objeto: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(objeto).filter(
      ([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
    ),
  );
}

/** El `Restaurant` de la carta, con su `Menu` tal como se ve en este nivel. */
export function jsonLdDeLaCarta(d: DatosJsonLd): Record<string, unknown> {
  const url = (slug: string | null) => urlDeLaCarta(d.origen, slug, d.idioma);
  const secciones = d.secciones
    .filter((s) => s.productCount > 0)
    .map((s) => ({ "@type": "MenuSection", name: s.name, url: url(s.slug) }));
  const platos = d.platos.map((p) => ({
    "@type": "MenuItem",
    name: p.name,
    offers: { "@type": "Offer", price: p.price.toFixed(2), priceCurrency: d.currency },
  }));

  const raizDeLaCarta = `${url(null)}${d.idioma ? "&" : "?"}ver=carta`;
  const hasMenu = d.bienvenida
    ? raizDeLaCarta
    : compacto({
        "@type": "Menu",
        url: d.categoria ? url(d.categoria.slug) : raizDeLaCarta,
        hasMenuSection: d.categoria
          ? [
              compacto({
                "@type": "MenuSection",
                name: d.categoria.nombre,
                url: url(d.categoria.slug),
                hasMenuSection: secciones,
                hasMenuItem: platos,
              }),
            ]
          : secciones,
      });

  return compacto({
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: d.businessName,
    url: url(null),
    description: d.tagline,
    address: d.ficha ? direccionJsonLd(d.ficha) : null,
    telephone: d.ficha?.phone ?? null,
    openingHoursSpecification: d.ficha?.openingHours ? horarioJsonLd(d.ficha.openingHours) : null,
    hasMenu,
  });
}

/** Listo para un `<script>`: `<` escapado, así ningún texto del cliente puede cerrarlo. */
export function jsonLdEnTexto(datos: Record<string, unknown>): string {
  return JSON.stringify(datos).replace(/</g, "\\u003c");
}
