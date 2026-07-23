import { allergenEmoji } from "@/lib/allergen-icon";
import type { MenuAllergen } from "../menu-view";
import styles from "./allergens.module.css";

/**
 * Badges de los alérgenos DECLARADOS de un plato, sobre su tarjeta -- el aviso a simple vista
 * que pedía la carta real. Es CONTENIDO (lo que declaró el gestor), no decoración: se pinta
 * igual en todos los temas, cada uno solo decide dónde colocarlo. Nunca se infiere nada: si la
 * lista viene vacía, no se pinta ningún badge (que NO es lo mismo que "no tiene alérgenos").
 *
 * Cada badge lleva el nombre completo como texto accesible; el emoji, solo cuando es
 * inequívoco (ver `allergenEmoji`), y si no, el nombre corto. La lista precisa está en la
 * ficha.
 */
export function AllergenBadges({ allergens }: { allergens: MenuAllergen[] }) {
  if (allergens.length === 0) return null;

  return (
    <ul className={styles.badges} data-testid="allergen-badges" aria-label="Alérgenos">
      {allergens.map((allergen) => {
        const emoji = allergenEmoji(allergen.icon);
        return (
          <li
            key={allergen.id}
            className={styles.badge}
            title={allergen.name}
            aria-label={allergen.name}
            data-allergen={allergen.id}
          >
            {emoji ? <span aria-hidden="true">{emoji}</span> : allergen.name}
          </li>
        );
      })}
    </ul>
  );
}
