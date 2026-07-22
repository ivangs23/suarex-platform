import { GarumTheme } from "./garum";
import { GenericTheme } from "./generic";
import { ManuelaTheme } from "./manuela";
import { pickFromRegistry } from "./pick";
import type { MenuTheme } from "./types";

/**
 * Registro de temas de la carta pública, indexado por el slug que guarda
 * `tenant_settings.theme`. `generic` es la plantilla tokenizada que se pinta sola con el
 * branding (la que usa cualquier cliente que no quiera un diseño propio); el resto son
 * temas A MEDIDA codificados para clientes con identidad visual propia.
 *
 * Añadir un cliente a medida = añadir su componente aquí y poner su slug en
 * `tenant_settings.theme`. No hay que tocar la página ni el data layer: todos los temas
 * comparten el contrato `MenuThemeProps`.
 */
const THEMES: Record<string, MenuTheme> = {
  generic: GenericTheme,
  garum: GarumTheme,
  manuela: ManuelaTheme,
};

export const DEFAULT_THEME = "generic";

/**
 * Devuelve el tema de un slug. Un slug desconocido, vacío o `null` cae SIEMPRE al genérico
 * -- un tenant mal configurado (o uno nuevo sin tema) renderiza una carta válida en vez de
 * romper la página.
 */
export function resolveTheme(slug: string | null | undefined): MenuTheme {
  return pickFromRegistry(THEMES, slug, DEFAULT_THEME);
}

export type { MenuTheme, MenuThemeProps, ThemeCategory, ThemeProduct } from "./types";
