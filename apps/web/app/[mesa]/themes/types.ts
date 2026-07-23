import type { Branding } from "@suarex/config";
import type { ReactNode } from "react";
import type { Strings } from "@/lib/i18n";
import type { MenuView } from "../menu-view";

/** Una opción del selector de idioma, ya resuelta a enlace. */
export type MenuLang = { code: string; label: string; href: string; active: boolean };

/**
 * Contrato ÚNICO que reciben todos los temas de la carta.
 *
 * LA REGLA, que este contrato existe para hacer cumplir:
 *
 *   La FUNCIONALIDAD es la misma para todos los clientes. Un paso del flujo, el carrito, el
 *   pedido: si se desarrolla, se desarrolla para todos. Lo que cambia de un cliente a otro
 *   es el ASPECTO (qué colores, dónde cae cada cosa) y el CONTENIDO (sus productos, sus
 *   fotos, la imagen de su bienvenida).
 *
 * De ahí que la página resuelva el nivel de navegación (`buildMenuView`) y se lo pase al
 * tema ya masticado: un tema solo PINTA -- no navega, no consulta, no calcula y no decide
 * qué pasos existen. Un tema a medida es una hoja de estilo con opiniones, no una variante
 * del producto.
 *
 * Lo vigila `contract.test.tsx`, que renderiza TODOS los temas registrados y comprueba que
 * ninguno se salte un paso.
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
   * Pantalla de BIENVENIDA: un paso independiente ANTES de la carta, con la marca del
   * cliente y un "toca para empezar". No es una cabecera que se desplaza -- es otra
   * pantalla, y hasta tocarla no hay carta.
   *
   * La tienen TODOS los clientes: es un paso del flujo. Lo que cada tema decide es cómo se
   * ve, y lo que cada cliente configura es la foto (`branding.heroUrl`, desde su panel).
   * Ningún tema puede ignorar este campo -- `contract.test.tsx` lo comprueba.
   *
   * Se modela como un paso de URL (`?ver=carta`) y no como estado de cliente, igual que el
   * resto de la navegación: funciona sin JavaScript, se puede compartir el enlace y el
   * botón "atrás" hace lo esperado.
   *
   * `active` es `false` en cuanto hay categoría elegida o el comensal ya entró.
   */
  welcome: { active: boolean; href: string };
  /**
   * Idiomas en los que ESTE cliente tiene carta, con el enlace para cambiar a cada uno.
   *
   * Se deducen de sus datos (ver `availableLangs`), no de un ajuste: ofrecer "EN" para acabar
   * enseñando la carta en español es peor que no ofrecerlo. Un cliente con un solo idioma
   * recibe un único elemento, y el tema no pinta selector.
   *
   * Cambiar de idioma es un paso de URL, como el nivel o la bienvenida: funciona sin
   * JavaScript y un enlace compartido enseña lo mismo a quien lo abra.
   */
  langs: MenuLang[];
  /**
   * Textos que pone la PLATAFORMA, ya en el idioma elegido ("Toca para empezar", "platos",
   * "Explorar otras categorías"...). Un tema nunca escribe estas cadenas a pelo: si lo
   * hiciera, su carta se quedaría en español al cambiar de idioma -- y sería otra vez una
   * diferencia de funcionalidad entre clientes según quién escribió su tema.
   *
   * Lo que describe la COMIDA no está aquí: sale del catálogo del cliente.
   */
  strings: Strings;
};

export type MenuTheme = (props: MenuThemeProps) => ReactNode;

export type { MenuCrumb, MenuNode, MenuProduct, MenuView } from "../menu-view";
