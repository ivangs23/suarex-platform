import { GenericTheme } from "./generic";
import { pickFromRegistry } from "./pick";
import type { MenuTheme } from "./types";

/**
 * Registro de temas de la carta pública, indexado por el slug que guarda
 * `tenant_settings.theme`. Hoy hay UNO: `generic`, que se pinta entero con el branding del
 * cliente (colores, fuentes, tokens y ejes de layout). Un cliente con aspecto propio es DATO,
 * no un componente: ver `docs/superpowers/specs/2026-10-22-temas-data-driven-design.md`.
 *
 * El registro se mantiene por si algún día hace falta un tema de código; si se añade, entra
 * solo en `contract.test.tsx`, que recorre `THEMES` entero.
 */
export const THEMES: Record<string, MenuTheme> = {
  generic: GenericTheme,
};

export const DEFAULT_THEME = "generic";

/**
 * Devuelve el tema de un slug. Un slug desconocido, vacío o `null` cae SIEMPRE al genérico
 * -- un tenant mal configurado (o uno con un tema de código ya retirado) renderiza una carta
 * válida en vez de romper la página.
 */
export function resolveTheme(slug: string | null | undefined): MenuTheme {
  return pickFromRegistry(THEMES, slug, DEFAULT_THEME);
}

export type {
  MenuCrumb,
  MenuNode,
  MenuProduct,
  MenuTheme,
  MenuThemeProps,
  MenuView,
} from "./types";
