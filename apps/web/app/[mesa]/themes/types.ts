import type { Branding } from "@suarex/config";
import type { ReactNode } from "react";

export type ThemeProduct = {
  id: string;
  name: string;
  /** Precio en euros (la columna es `numeric(10,2)`, ver packages/db). */
  price: number;
};

export type ThemeCategory = {
  id: string;
  name: string;
  products: ThemeProduct[];
};

/**
 * Contrato ÚNICO que reciben todos los temas de la carta. La página
 * (`app/[mesa]/page.tsx`) hace una sola carga de datos y se lo pasa tal cual al tema que
 * corresponda; un tema es presentación pura -- nunca hace I/O ni conoce el tenant más allá
 * de estas props. Que el contrato sea uno solo es lo que permite añadir temas a medida sin
 * tocar la página ni el data layer.
 */
export type MenuThemeProps = {
  tenantSlug: string;
  /** Nombre comercial ya resuelto (branding.name, con fallback al slug). */
  businessName: string;
  mesa: string;
  branding: Branding;
  categories: ThemeCategory[];
  /** Total crudo de productos del tenant, para el marcador oculto de los e2e. */
  productCount: number;
};

export type MenuTheme = (props: MenuThemeProps) => ReactNode;
