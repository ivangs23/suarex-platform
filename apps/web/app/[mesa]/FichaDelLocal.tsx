import { DIAS_DE_LA_SEMANA, type FichaDeLaSede, type Tramo } from "@suarex/db";
import {
  diaEnLaSede,
  direccionEnTexto,
  enlaceDeTelefono,
  nombresDeLosDias,
  tramoEnTexto,
} from "@/lib/ficha";
import type { Lang, Strings } from "@/lib/i18n";
import styles from "./ficha-del-local.module.css";

/**
 * Dirección, teléfono y horario del local, al pie de la carta. Lo monta la PÁGINA y no el tema,
 * igual que `LegalFooter`: es información del local, no decoración. Sin nada guardado no pinta
 * nada, y de lo guardado solo pinta lo que hay. La semana va en un `<details>`: sin JS.
 */
export function FichaDelLocal({
  ficha,
  lang,
  strings: t,
  ahora = new Date(),
}: {
  ficha: FichaDeLaSede | null;
  lang: Lang;
  strings: Strings;
  ahora?: Date;
}) {
  if (!ficha) return null;
  const direccion = direccionEnTexto(ficha);
  const horario = ficha.openingHours;
  const publicados = DIAS_DE_LA_SEMANA.filter((dia) => horario?.[dia] !== undefined);
  if (!direccion && !ficha.phone && publicados.length === 0) return null;

  const nombres = nombresDeLosDias(lang);
  const texto = (tramos: Tramo[]) =>
    tramos.length === 0 ? t.fichaCerrado : tramos.map((tr) => tramoEnTexto(tr, lang)).join(", ");
  const hoy = horario?.[diaEnLaSede(ahora, ficha.timezone)];

  return (
    <section className={styles.ficha} data-testid="ficha-del-local">
      {direccion ? <p data-testid="ficha-direccion">{direccion}</p> : null}
      {ficha.phone ? (
        <p>
          <a className={styles.enlace} href={enlaceDeTelefono(ficha.phone)}>
            {ficha.phone}
          </a>
        </p>
      ) : null}
      {publicados.length > 0 ? (
        <details className={styles.horario}>
          <summary data-testid="ficha-hoy">
            {hoy ? `${t.fichaHoy}: ${texto(hoy)}` : t.fichaHorario}
            <span className={styles.ver}>{t.fichaVerHorario}</span>
          </summary>
          <dl className={styles.semana}>
            {publicados.map((dia) => (
              <div key={dia} className={styles.dia}>
                <dt>{nombres[dia]}</dt>
                <dd>{texto(horario?.[dia] ?? [])}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
