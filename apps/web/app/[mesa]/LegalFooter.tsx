import type { Strings } from "@/lib/i18n";
import { DOCUMENTOS_LEGALES } from "@/lib/legal-content";
import styles from "./legal-footer.module.css";

/**
 * Pie legal de la carta.
 *
 * Lo monta `page.tsx`, NO cada tema: mismo criterio que `<CartPanelHost />` (ver page.tsx,
 * "el PANEL lo monta la página... un tema que se lo saltara dejaría a ese cliente sin forma
 * de pagar"). Un tema decide cómo se ve la carta; nunca si el comensal tiene acceso a la
 * política de privacidad del restaurante. Montado aquí, ningún tema PUEDE saltárselo:
 * garantía estructural, más fuerte que un test.
 *
 * Las etiquetas salen de `Strings`, no fijas en español: el contrato de temas vigila
 * precisamente que no se escriba castellano a pelo en los textos de plataforma.
 */
export function LegalFooter({ strings: t }: { strings: Strings }) {
  const etiquetas: Record<(typeof DOCUMENTOS_LEGALES)[number], string> = {
    privacidad: t.legalPrivacy,
    "aviso-legal": t.legalNotice,
    condiciones: t.legalTerms,
  };

  return (
    <footer className={styles.footer} data-testid="legal-footer">
      {DOCUMENTOS_LEGALES.map((slug) => (
        <a key={slug} className={styles.link} href={`/legal/${slug}`}>
          {etiquetas[slug]}
        </a>
      ))}
    </footer>
  );
}
