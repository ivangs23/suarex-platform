import { describe, expect, it } from "vitest";
import {
  parseBrandingFields,
  parseCurrency,
  parseCustomDomain,
  parseFiscalFields,
  parseLocale,
} from "./settings-action-input";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

/** Un formulario de marca válido, tal como lo manda el panel; cada test cambia lo que prueba. */
function valido(cambios: Record<string, string> = {}): FormData {
  return fd({
    name: "Bar Manuela",
    color_bg: "#ffffff",
    color_fg: "#000000",
    color_primary: "#a88445",
    color_accent: "#1f1d1a",
    color_muted: "#d9d1bd",
    font_display: "playfair",
    font_body: "inter",
    token_surface: "",
    token_radius: "md",
    token_control_radius: "pill",
    token_shadow: "none",
    token_border: "thin",
    token_spacing: "compact",
    token_titles: "normal",
    token_image_fit: "cover",
    token_thumb: "sm",
    token_cart_icon: "none",
    layout_welcome: "panel",
    layout_hero: "plain",
    layout_nav: "back-button",
    layout_categories: "icon-tiles",
    layout_products: "list",
    layout_langs: "code",
    background_size: "150",
    badge_emoji: "",
    badge_color: "#a88445",
    ...cambios,
  });
}

describe("parseBrandingFields", () => {
  it("parsea la marca entera", () => {
    expect(parseBrandingFields(valido())).toEqual({
      name: "Bar Manuela",
      colors: {
        bg: "#ffffff",
        fg: "#000000",
        primary: "#a88445",
        accent: "#1f1d1a",
        muted: "#d9d1bd",
      },
      fonts: { display: "playfair", body: "inter" },
      tokens: {
        surface: null,
        radius: "md",
        controlRadius: "pill",
        shadow: "none",
        border: "thin",
        spacing: "compact",
        titles: "normal",
        imageFit: "cover",
        thumb: "sm",
        cartIcon: "none",
      },
      layout: {
        welcome: "panel",
        hero: "plain",
        nav: "back-button",
        categories: "icon-tiles",
        products: "list",
        langs: "code",
      },
      backgroundSizePx: 150,
      tagline: {},
      badge: null,
    });
  });

  it("nombre vacío => null", () => {
    expect(parseBrandingFields(valido({ name: "" })).name).toBeNull();
  });

  it("rechaza un color no-hex", () => {
    expect(() => parseBrandingFields(valido({ color_bg: "rojo" }))).toThrow(/color/i);
  });

  it("rechaza una fuente que no es de las que carga la app", () => {
    expect(() => parseBrandingFields(valido({ font_display: "Georgia" }))).toThrow(/fuente/i);
    expect(() => parseBrandingFields(valido({ font_body: "a<b" }))).toThrow(/fuente/i);
  });

  it("acepta un nombre de exactamente 80 caracteres", () => {
    const name = "a".repeat(80);
    expect(parseBrandingFields(valido({ name })).name).toBe(name);
  });

  it("rechaza un nombre de 81 caracteres", () => {
    expect(() => parseBrandingFields(valido({ name: "a".repeat(81) }))).toThrow(/80|nombre/i);
  });

  it("recoge los ejes y tokens que no son los de por defecto", () => {
    const out = parseBrandingFields(
      valido({
        layout_welcome: "poster",
        layout_products: "cards",
        token_shadow: "medium",
        token_surface: "#fff8e7",
      }),
    );
    expect(out.layout.welcome).toBe("poster");
    expect(out.layout.products).toBe("cards");
    expect(out.tokens.shadow).toBe("medium");
    expect(out.tokens.surface).toBe("#fff8e7");
  });

  it("rechaza un valor de select que no existe (petición fabricada a mano)", () => {
    expect(() => parseBrandingFields(valido({ layout_products: "carrusel" }))).toThrow(
      /layout_products/,
    );
    expect(() => parseBrandingFields(valido({ token_shadow: "brutal" }))).toThrow(/token_shadow/);
  });

  it("rechaza una superficie que no es un color", () => {
    expect(() => parseBrandingFields(valido({ token_surface: "blanco" }))).toThrow(/color/i);
  });

  it("el lema se guarda por idioma, sin los vacíos", () => {
    const out = parseBrandingFields(
      valido({ tagline_es: "Vinoteca & cocina de producto", tagline_en: "", tagline_pt: "  " }),
    );
    expect(out.tagline).toEqual({ es: "Vinoteca & cocina de producto" });
  });

  it("rechaza un lema de más de 120 caracteres", () => {
    expect(() => parseBrandingFields(valido({ tagline_en: "x".repeat(121) }))).toThrow(/lema/i);
  });

  it("la insignia necesita un emoji; con él, se guarda con su color", () => {
    expect(parseBrandingFields(valido({ badge_emoji: "" })).badge).toBeNull();
    expect(
      parseBrandingFields(valido({ badge_emoji: "☕", badge_color: "#1b4d3e" })).badge,
    ).toEqual({ emoji: "☕", color: "#1b4d3e" });
    expect(() => parseBrandingFields(valido({ badge_emoji: "un texto largo de verdad" }))).toThrow(
      /emoji/i,
    );
  });

  it("rechaza un tamaño de textura fuera de rango", () => {
    expect(() => parseBrandingFields(valido({ background_size: "10" }))).toThrow(/textura/i);
    expect(() => parseBrandingFields(valido({ background_size: "grande" }))).toThrow(/textura/i);
  });
});

describe("parseFiscalFields", () => {
  it("convierte el IVA de porcentaje a fracción", () => {
    expect(parseFiscalFields(fd({ tax_rate: "10" })).taxRate).toBeCloseTo(0.1);
  });
  it("deja taxRate undefined si no viene", () => {
    expect(parseFiscalFields(fd({})).taxRate).toBeUndefined();
  });
  it("rechaza un IVA fuera de 0..100", () => {
    expect(() => parseFiscalFields(fd({ tax_rate: "150" }))).toThrow(/IVA|100/i);
  });
  it("rechaza un IVA no numérico", () => {
    expect(() => parseFiscalFields(fd({ tax_rate: "diez" }))).toThrow(/IVA|número/i);
  });
  it("recoge legalName/cif/address/phone opcionales", () => {
    const out = parseFiscalFields(
      fd({ legal_name: "Casa SL", cif: "B123", address: "Calle 1", phone: "600" }),
    );
    expect(out).toMatchObject({
      legalName: "Casa SL",
      cif: "B123",
      address: "Calle 1",
      phone: "600",
    });
  });
});

describe("parseCurrency", () => {
  it("acepta un código de 3 letras y lo pone en mayúsculas", () => {
    expect(parseCurrency(fd({ currency: "usd" }))).toBe("USD");
  });
  it("rechaza un código que no tiene 3 letras", () => {
    expect(() => parseCurrency(fd({ currency: "EU" }))).toThrow(/moneda|3/i);
  });
});

describe("parseLocale", () => {
  it("por defecto es", () => {
    expect(parseLocale(fd({}))).toBe("es");
  });
  it("recoge el locale dado", () => {
    expect(parseLocale(fd({ locale: "en" }))).toBe("en");
  });
});

describe("parseCustomDomain", () => {
  const ROOTS = ["suarex.app"];

  it("acepta un dominio real y lo normaliza", () => {
    expect(parseCustomDomain(fd({ custom_domain: "GarumVinoteca.com" }), ROOTS)).toBe(
      "garumvinoteca.com",
    );
  });

  it("un campo vacío quita el dominio configurado", () => {
    expect(parseCustomDomain(fd({}), ROOTS)).toBeNull();
    expect(parseCustomDomain(fd({ custom_domain: "   " }), ROOTS)).toBeNull();
  });

  it("rechaza en el borde en vez de degradar", () => {
    // Este campo decide qué certificados pide Caddy: un valor basura no rompe una
    // pantalla, agota una cuota de Let's Encrypt compartida por todos los clientes.
    expect(() => parseCustomDomain(fd({ custom_domain: "https://x.com" }), ROOTS)).toThrow(
      /Dominio inválido/,
    );
    expect(() => parseCustomDomain(fd({ custom_domain: "localhost" }), ROOTS)).toThrow(
      /Dominio inválido/,
    );
  });

  it("rechaza reclamar algo bajo el dominio de la plataforma", () => {
    expect(() => parseCustomDomain(fd({ custom_domain: "otro.suarex.app" }), ROOTS)).toThrow(
      /Dominio inválido/,
    );
  });
});
