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
  /**
   * Pantalla de BIENVENIDA, un paso independiente ANTES de la carta.
   *
   * La carta de Manuela arranca así: una pantalla completa con su marca y un "toca para
   * empezar" que lleva a los productos. No es una cabecera que se desplaza -- es otra
   * pantalla.
   *
   * Se modela como un paso de URL (`?ver=carta`) y no como estado de cliente, igual que el
   * resto de la navegación: funciona sin JavaScript, se puede compartir el enlace y el
   * botón "atrás" hace lo esperado.
   *
   * `active` es `false` en cuanto hay categoría elegida o el comensal ya entró. Un tema que
   * no quiera este paso -- garum y el genérico van directos a las categorías -- simplemente
   * ignora este campo.
   */
  welcome: { active: boolean; href: string };
};

export type MenuTheme = (props: MenuThemeProps) => ReactNode;

export type { MenuCrumb, MenuNode, MenuProduct, MenuView } from "../menu-view";
