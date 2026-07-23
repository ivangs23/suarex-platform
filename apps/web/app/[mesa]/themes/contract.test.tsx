import { DEFAULT_BRANDING } from "@suarex/config";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "@/lib/i18n";
import { CartProvider } from "../cart/CartProvider";
import { THEMES } from "./index";
import type { MenuThemeProps, MenuView } from "./types";

/**
 * CONTRATO DE LOS TEMAS -- el guardián de la regla del producto:
 *
 *   La FUNCIONALIDAD es la misma para todos los clientes. Lo que cambia por cliente es el
 *   aspecto: qué foto se ve, dónde cae cada cosa, con qué colores. Un paso del flujo no es
 *   opcional según el cliente; una foto sí.
 *
 * Sin esto la regla se rompe sola y en silencio: un tema a medida se escribe copiando otro,
 * quien lo escribe no pinta un paso, y nadie se entera hasta que un cliente pregunta por qué
 * su carta no hace lo que hace la del vecino. Ya pasó una vez -- la pantalla de bienvenida
 * nació pintándose solo en el tema de Manuela.
 *
 * Se comprueba por `data-testid` porque es lo que ya usa la suite e2e como contrato
 * compartido, y porque comprobar el marcado exacto prohibiría justo lo que SÍ debe variar.
 *
 * Recorre `THEMES` entero, no una lista escrita a mano: un tema nuevo entra en el test por
 * el mero hecho de registrarse.
 */

const VIEW_RAIZ: MenuView = {
  currentName: null,
  breadcrumb: [],
  rootHref: "/5?ver=carta",
  children: [
    {
      id: "c1",
      slug: "vinos",
      name: "Vinos",
      icon: "🍷",
      imageUrl: null,
      productCount: 3,
      href: "/5?cat=vinos",
    },
  ],
  products: [],
  totalProducts: 8,
};

const VIEW_HOJA: MenuView = {
  currentName: "Tintos",
  breadcrumb: [{ name: "Vinos", href: "/5?cat=vinos" }],
  rootHref: "/5?ver=carta",
  children: [],
  products: [
    {
      id: "p1",
      name: "Ribera del Duero",
      description: "Crianza de la ribera",
      price: 18,
      priceCents: 1800,
      priceLabel: "18,00 €",
      imageUrl: "https://storage.test/foto.jpg",
      extras: [{ id: "e1", name: "Copa extra", priceCents: 300, priceLabel: "3,00 €" }],
      allergens: [
        { id: 7, name: "Lácteos", icon: "milk" },
        { id: 12, name: "Sulfitos", icon: null },
      ],
    },
  ],
  totalProducts: 8,
};

function props(overrides: Partial<MenuThemeProps>): MenuThemeProps {
  return {
    tenantSlug: "prueba",
    businessName: "Bar de Prueba",
    mesa: "5",
    branding: DEFAULT_BRANDING,
    view: VIEW_RAIZ,
    welcome: { active: false, href: "/5?ver=carta" },
    langs: [
      { code: "es", label: "ES", href: "/5?ver=carta", active: true },
      { code: "en", label: "EN", href: "/5?ver=carta&lang=en", active: false },
    ],
    strings: strings("es"),
    ...overrides,
  };
}

const nombres = Object.keys(THEMES);

it("hay temas registrados que comprobar", () => {
  // Si el registro se vacía o se renombra, los describe.each de abajo pasarían sin ejecutar
  // ni una sola comprobación, y el contrato quedaría sin vigilar en silencio.
  expect(nombres.length).toBeGreaterThan(0);
});

describe.each(nombres)("tema %s", (nombre) => {
  const Theme = THEMES[nombre];
  if (!Theme) throw new Error(`tema '${nombre}' registrado pero vacío`);
  // El carrito es un componente de cliente con su propio contexto: el tema se envuelve en el
  // proveedor, igual que hace la página, o el botón de añadir no tendría de dónde salir.
  const render = (overrides: Partial<MenuThemeProps>, canOrder = true) => {
    // El carrito recibe los MISMOS textos que el tema: en la app los dos salen de
    // `strings(lang)`, y separarlos aquí probaría una situación que no ocurre.
    const p = props(overrides);
    return renderToStaticMarkup(
      <CartProvider locale="es" currency="EUR" canOrder={canOrder} strings={p.strings}>
        {Theme(p)}
      </CartProvider>,
    );
  };

  it("pinta la pantalla de bienvenida cuando toca, con su enlace de entrada", () => {
    // El paso existe para TODOS. Lo que cada tema decide es cómo se ve, no si ocurre.
    const html = render({ welcome: { active: true, href: "/5?ver=carta" } });

    expect(html).toContain('data-testid="welcome-enter"');
    expect(html).toContain("/5?ver=carta");
  });

  it("en la bienvenida no adelanta la carta", () => {
    // Si pintara ya las categorías, sería una cabecera, no un paso: el comensal vería la
    // carta sin haber entrado y el "toca para empezar" no significaría nada.
    const html = render({ welcome: { active: true, href: "/5?ver=carta" } });

    expect(html).not.toContain('data-testid="category"');
    expect(html).not.toContain('data-testid="product"');
  });

  it("identifica al cliente y la mesa en la bienvenida", () => {
    const html = render({ welcome: { active: true, href: "/5?ver=carta" } });

    expect(html).toContain('data-testid="tenant-name"');
    expect(html).toContain('data-testid="mesa"');
    expect(html).toContain("Bar de Prueba");
    expect(html).toContain("5");
  });

  it("dentro de la carta expone el conteo crudo de productos del tenant", () => {
    // La suite e2e lo usa para detectar una fuga entre tenants aunque nada visible cambie.
    expect(render({})).toContain('data-testid="product-count"');
  });

  it("en la raíz pinta las categorías navegables con su enlace", () => {
    const html = render({});

    expect(html).toContain('data-testid="category"');
    expect(html).toContain("/5?cat=vinos");
    expect(html).toContain("Vinos");
  });

  it("en una hoja pinta los productos con su precio ya formateado", () => {
    const html = render({ view: VIEW_HOJA });

    expect(html).toContain('data-testid="product"');
    expect(html).toContain("Ribera del Duero");
    // El precio lo formatea la vista con el idioma y la moneda del tenant: un tema que lo
    // recalculara enseñaría otra moneda que la configurada.
    expect(html).toContain("18,00 €");
  });

  it("pinta la foto del producto cuando la hay, y no deja hueco cuando no", () => {
    expect(render({ view: VIEW_HOJA })).toContain('data-testid="product-photo"');

    const sinFoto: MenuView = {
      ...VIEW_HOJA,
      products: VIEW_HOJA.products.map((p) => ({ ...p, imageUrl: null })),
    };
    expect(render({ view: sinFoto })).not.toContain('data-testid="product-photo"');
  });

  it("pinta los alérgenos declarados como badges sobre la tarjeta", () => {
    // Es un aviso a simple vista, y es CONTENIDO (lo que declaró el gestor): igual en todos
    // los temas. Un alérgeno con emoji inequívoco se muestra con él; el resto, con su nombre
    // -- nunca un emoji ambiguo que induzca a error. La lista completa vive en la ficha.
    const html = render({ view: VIEW_HOJA });
    expect(html).toContain('data-testid="allergen-badges"');
    // Lácteos -> emoji de leche; y su nombre completo va como texto accesible.
    expect(html).toContain("🥛");
    expect(html).toContain('aria-label="Lácteos"');
    // Sulfitos no tiene emoji claro: se muestra su nombre en el badge, no un emoji dudoso.
    expect(html).toContain("Sulfitos");
  });

  it("un plato sin alérgenos declarados no pinta ningún badge", () => {
    // Vacío significa "no hay ninguno declarado", NO "no tiene": no se pinta nada, no se
    // afirma nada.
    const sinAlergenos: MenuView = {
      ...VIEW_HOJA,
      products: VIEW_HOJA.products.map((p) => ({ ...p, allergens: [] })),
    };
    expect(render({ view: sinAlergenos })).not.toContain('data-testid="allergen-badges"');
  });

  it("deja abrir la ficha del producto para pedirlo", () => {
    // Pedir es FUNCIONALIDAD: la tienen todos los clientes. Un tema a medida escrito
    // copiando otro y al que se le olvide el control deja a ese cliente con una carta que no
    // vende, y eso no se ve en ninguna captura.
    //
    // La ficha (alérgenos, opciones, notas, total) es un componente compartido que se monta
    // al abrirla, así que aquí se comprueba la puerta -- que es lo que pinta el tema.
    const html = render({ view: VIEW_HOJA });

    expect(html).toContain('data-testid="open-product-sheet"');
  });

  it("coloca la puerta al pedido en algún sitio de su carta", () => {
    // DÓNDE va es del tema (la bolsa de la cabecera en Manuela, un botón en otro); QUE esté,
    // no: sin ella, ese cliente tendría una carta en la que se puede añadir y no se puede
    // pagar. El panel que abre lo pinta la página, así que ningún tema puede saltárselo.
    expect(render({ view: VIEW_HOJA })).toContain('data-testid="cart-open"');
  });

  it("sin haber escaneado el QR de la mesa, la carta se consulta pero no se pide", () => {
    // La cookie del QR es lo único que demuestra que quien pide está sentado en esa mesa.
    const html = render({ view: VIEW_HOJA }, false);

    expect(html).toContain('data-testid="product"');
    expect(html).not.toContain('data-testid="open-product-sheet"');
    expect(html).not.toContain('data-testid="cart-open"');
  });

  it("ofrece cambiar de idioma cuando el cliente tiene carta en más de uno", () => {
    // Un guiri en la terraza no puede depender de qué tema le tocó: si el suyo se olvidó del
    // selector, su cliente pierde la traducción que ya pagó al migrar el catálogo.
    const html = render({ view: VIEW_HOJA });

    expect(html).toContain('data-testid="lang-switch"');
    expect(html).toContain("/5?ver=carta&amp;lang=en");
  });

  it("también deja cambiar de idioma en la bienvenida", () => {
    // Es la PRIMERA pantalla: sin selector aquí, quien no lee español tiene que entrar a
    // ciegas para poder cambiarlo.
    const html = render({ welcome: { active: true, href: "/5?ver=carta" } });

    expect(html).toContain('data-testid="lang-switch"');
  });

  it("con un solo idioma no pinta selector", () => {
    // Un botón "ES" solitario que no lleva a ninguna parte es ruido en la carta.
    const html = render({
      view: VIEW_HOJA,
      langs: [{ code: "es", label: "ES", href: "/5?ver=carta", active: true }],
    });

    expect(html).not.toContain('data-testid="lang-switch"');
  });

  it("no escribe en español los textos de la plataforma", () => {
    // Un tema que escriba "Explorar otras categorías" a pelo se queda en español al cambiar
    // de idioma, y eso vuelve a ser una diferencia de funcionalidad según quién lo escribió.
    const html = render({ view: VIEW_HOJA, strings: strings("en") });

    // La puerta al pedido la pinta todo tema, así que sirve de sonda: si el idioma no llegara
    // hasta ahí, aquí seguiría poniendo "Tu pedido".
    expect(html).toContain("Your order");
    expect(html).not.toContain("Tu pedido");
    expect(html).not.toContain("Explorar otras categorías");
    expect(html).not.toContain("Añadir / Personalizar");
  });

  it("traduce también la bienvenida y el recuento de platos", () => {
    expect(render({ view: VIEW_RAIZ, strings: strings("en") })).toContain("dishes");
    expect(
      render({ welcome: { active: true, href: "/5?ver=carta" }, strings: strings("en") }),
    ).toContain("Tap to start");
  });

  it("ofrece la vuelta al primer nivel desde dentro de una categoría", () => {
    const html = render({ view: VIEW_HOJA });

    // Con `?ver=carta`: la raíz pelada es la BIENVENIDA, así que un tema que compusiera su
    // propio enlace a `/5` echaría al comensal fuera de la carta en vez de subirlo un nivel.
    expect(html).toContain("/5?ver=carta");
    expect(html).toContain("Tintos");
  });
});
