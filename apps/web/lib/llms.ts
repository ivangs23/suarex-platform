import { DIAS_DE_LA_SEMANA, type FichaPublica } from "@suarex/db";
import { direccionEnTexto, nombresDeLosDias, tramoEnTexto } from "./ficha";
import { type Lang, strings } from "./i18n";
import { urlDeLaCarta } from "./metadatos";
import { platosPorCategoria } from "./rastreo";

export type DatosLlms = {
  businessName: string;
  tagline: string | null;
  origen: string;
  /** El idioma del cliente: el de sus URL sin `?lang=`. */
  lang: Lang;
  /** Las de `leerCarta`, con el nombre ya en `lang`. */
  categorias: readonly { id: string; slug: string; parentId: string | null; nombre: string }[];
  productos: readonly { categoryId: string }[];
  ficha: FichaPublica | null;
};

const mayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);
const enlace = (texto: string) => texto.replace(/[[\]]/g, "\\$&");

/**
 * El `llms.txt` del cliente (formato de llmstxt.org): su nombre y lema, la carta por categorías
 * con su número de platos, cómo se pide y, solo si existe, la ficha del local. Hechos, nunca
 * instrucciones a quien lo lea. Las categorías vacías no salen, como en la carta y el sitemap.
 */
export function textoLlms(d: DatosLlms): string {
  const t = strings(d.lang);
  const platos = platosPorCategoria(d.categorias, d.productos);
  const conPlatos = d.categorias.filter((c) => (platos.get(c.id) ?? 0) > 0);

  const lineasDe = (padre: string | null, nivel: number): string[] =>
    conPlatos
      .filter((c) => c.parentId === padre)
      .flatMap((c) => {
        const n = platos.get(c.id) ?? 0;
        return [
          `${"  ".repeat(nivel)}- [${enlace(c.nombre)}](${urlDeLaCarta(d.origen, c.slug, null)}): ${n} ${n === 1 ? t.dish : t.dishes}`,
          ...lineasDe(c.id, nivel + 1),
        ];
      });

  const lineas = [`# ${d.businessName}`, ""];
  if (d.tagline) lineas.push(`> ${d.tagline}`, "");
  lineas.push(`## ${t.cartaTitle}`, "", ...lineasDe(null, 0), "");
  lineas.push(
    `## ${t.llmsComoSePide}`,
    "",
    `${t.llmsPedido} ${urlDeLaCarta(d.origen, null, null)}`,
    "",
  );

  const f = d.ficha;
  const direccion = f ? direccionEnTexto(f) : null;
  if (direccion) lineas.push(`## ${t.llmsDireccion}`, "", direccion, "");
  if (f?.phone) lineas.push(`## ${t.llmsTelefono}`, "", f.phone, "");
  const horario = f?.openingHours;
  const publicados = DIAS_DE_LA_SEMANA.filter((dia) => horario?.[dia] !== undefined);
  if (horario && publicados.length > 0) {
    const nombres = nombresDeLosDias(d.lang);
    lineas.push(`## ${t.fichaHorario}`, "");
    for (const dia of publicados) {
      const tramos = horario[dia] ?? [];
      const texto =
        tramos.length === 0
          ? t.fichaCerrado
          : tramos.map((tramo) => tramoEnTexto(tramo, d.lang)).join(", ");
      lineas.push(`- ${mayuscula(nombres[dia])}: ${texto}`);
    }
    lineas.push("");
  }

  return lineas.join("\n");
}
