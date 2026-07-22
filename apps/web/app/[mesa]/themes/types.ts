import type { Branding } from "@suarex/config";
import type { ReactNode } from "react";
import type { MenuView } from "../menu-view";

/**
 * Contrato ÚNICO que reciben todos los temas de la carta. La página resuelve el nivel de
 * navegación (`buildMenuView`) y se lo pasa ya masticado: un tema solo PINTA -- no navega,
 * no consulta y no calcula. Que el contrato sea uno solo es lo que permite añadir temas a
 * medida sin tocar la página ni el data layer.
 */
export type MenuThemeProps = {
  tenantSlug: string;
  /** Nombre comercial ya resuelto (branding.name, con fallback al slug). */
  businessName: string;
  mesa: string;
  branding: Branding;
  /** Nivel actual de la carta: hijos, productos, rastro de vuelta y totales. */
  view: MenuView;
};

export type MenuTheme = (props: MenuThemeProps) => ReactNode;

export type { MenuCrumb, MenuNode, MenuProduct, MenuView } from "../menu-view";
