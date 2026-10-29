import { DIAS_DE_LA_SEMANA, type DiaDeLaSemana, type FichaPublica, type Tramo } from "@suarex/db";
import { diaEnZona } from "@suarex/domain";

/** El día de la semana en la zona de la sede: a las 00:30 de Madrid ya es viernes y en Canarias
 *  aún jueves. El servidor (UTC en el VPS) no cuenta. */
export function diaEnLaSede(ahora: Date, zona: string): DiaDeLaSemana {
  const dia = new Date(`${diaEnZona(ahora, zona)}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return DIAS_DE_LA_SEMANA[(dia + 6) % 7] as DiaDeLaSemana;
}

/** Los nombres de los días en el idioma de la carta, de `Intl` (1-1-2024 fue lunes). */
export function nombresDeLosDias(lang: string): Record<DiaDeLaSemana, string> {
  const formato = new Intl.DateTimeFormat(lang, { weekday: "long", timeZone: "UTC" });
  return Object.fromEntries(
    DIAS_DE_LA_SEMANA.map((dia, i) => [dia, formato.format(new Date(Date.UTC(2024, 0, 1 + i)))]),
  ) as Record<DiaDeLaSemana, string>;
}

/** «13:00–16:00» en es, «1:00 PM–4:00 PM» en en. Las horas son ya locales de la sede. */
export function tramoEnTexto([desde, hasta]: Tramo, lang: string): string {
  const formato = new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const hora = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return formato.format(new Date(Date.UTC(2024, 0, 1, h, m)));
  };
  return `${hora(desde)}–${hora(hasta)}`;
}

/** «Calle Larios 5, 29005 Málaga», con la provincia solo si no es la ciudad. Lo que falta no sale. */
export function direccionEnTexto(ficha: FichaPublica): string | null {
  const localidad = [ficha.postalCode, ficha.city].filter(Boolean).join(" ");
  const partes = [
    ficha.street,
    localidad || null,
    ficha.region && ficha.region !== ficha.city ? ficha.region : null,
  ].filter((parte): parte is string => Boolean(parte));
  return partes.length > 0 ? partes.join(", ") : null;
}

/** `tel:` sin espacios ni puntos, para que el móvil marque al tocarlo. */
export function enlaceDeTelefono(telefono: string): string {
  return `tel:${telefono.replace(/[^\d+]/g, "")}`;
}
