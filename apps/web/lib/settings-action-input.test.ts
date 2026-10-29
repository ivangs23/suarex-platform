import { describe, expect, it } from "vitest";
import {
  fichaPublicaSchema,
  parseBrandingFields,
  parseCurrency,
  parseCustomDomain,
  parseFichaPublica,
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

describe("parseFichaPublica", () => {
  const ficha = (campos: Record<string, string> = {}) =>
    parseFichaPublica(fd({ venue_id: "sede-1", ...campos }));

  it("sin rellenar nada, todo es null: no se publica nada por defecto", () => {
    expect(ficha()).toEqual({
      venueId: "sede-1",
      ficha: {
        street: null,
        postalCode: null,
        city: null,
        region: null,
        phone: null,
        openingHours: null,
      },
    });
  });

  it("lee la dirección y el horario: cerrado, dos tramos y uno que pasa de medianoche", () => {
    const { ficha: f } = ficha({
      ficha_street: "  Calle Larios 5 ",
      ficha_postal_code: "29005",
      ficha_city: "Málaga",
      ficha_region: "Málaga",
      ficha_phone: "+34 952 000 000",
      h_mo_cerrado: "on",
      h_tu_1_desde: "13:00",
      h_tu_1_hasta: "16:00",
      h_tu_2_desde: "20:00",
      h_tu_2_hasta: "23:30",
      h_sa_1_desde: "20:00",
      h_sa_1_hasta: "02:00",
    });
    expect(f.street).toBe("Calle Larios 5");
    expect(f.phone).toBe("+34 952 000 000");
    expect(f.openingHours).toEqual({
      mo: [],
      tu: [
        ["13:00", "16:00"],
        ["20:00", "23:30"],
      ],
      sa: [["20:00", "02:00"]],
    });
  });

  it("«cerrado» manda aunque haya horas escritas", () => {
    const { ficha: f } = ficha({
      h_mo_cerrado: "on",
      h_mo_1_desde: "13:00",
      h_mo_1_hasta: "16:00",
    });
    expect(f.openingHours).toEqual({ mo: [] });
  });

  it.each([
    "612 345 678",
    "952.00.00.00",
    "+34 612345678",
    "0034 612 345 678",
    "+44 20 7946 0000",
  ])("acepta el teléfono %s", (telefono) => {
    expect(ficha({ ficha_phone: telefono }).ficha.phone).toBe(telefono);
  });

  it.each([
    "12345",
    "512 345 678",
    "llámanos",
    "+0 123 456 789",
  ])("rechaza el teléfono %s", (telefono) => {
    expect(() => ficha({ ficha_phone: telefono })).toThrow(/Teléfono inválido/);
  });

  it("rechaza una hora que no es HH:MM, y dice de qué día", () => {
    expect(() => ficha({ h_tu_1_desde: "25:00", h_tu_1_hasta: "16:00" })).toThrow(
      "Martes: Hora inválida: usa HH:MM",
    );
  });

  it("un tramo a medias no se pierde en silencio: se rechaza", () => {
    expect(() => ficha({ h_mo_1_desde: "13:00" })).toThrow(
      "Lunes: Cada tramo necesita hora de apertura y de cierre",
    );
  });

  it("un tramo no abre y cierra a la misma hora", () => {
    expect(() => ficha({ h_we_1_desde: "13:00", h_we_1_hasta: "13:00" })).toThrow(
      /Miércoles: Un tramo no puede abrir y cerrar a la misma hora/,
    );
  });

  it("el segundo tramo va después del primero", () => {
    expect(() =>
      ficha({
        h_th_1_desde: "20:00",
        h_th_1_hasta: "23:00",
        h_th_2_desde: "13:00",
        h_th_2_hasta: "16:00",
      }),
    ).toThrow(/Jueves: El segundo tramo va después del primero/);
  });

  it("solo el último tramo puede pasar de medianoche", () => {
    expect(() =>
      ficha({
        h_fr_1_desde: "20:00",
        h_fr_1_hasta: "02:00",
        h_fr_2_desde: "03:00",
        h_fr_2_hasta: "05:00",
      }),
    ).toThrow(/Viernes: .*solo el último puede pasar de medianoche/);
  });

  it("como máximo dos tramos por día (lo garantiza el esquema, no solo el formulario)", () => {
    const tres = {
      mo: [
        ["09:00", "10:00"],
        ["11:00", "12:00"],
        ["13:00", "14:00"],
      ],
    };
    const r = fichaPublicaSchema.safeParse({
      street: null,
      postalCode: null,
      city: null,
      region: null,
      phone: null,
      openingHours: tres,
    });
    expect(r.success).toBe(false);
  });

  it("sin sede, no hay dónde guardarla", () => {
    expect(() => parseFichaPublica(fd({}))).toThrow(/venue_id/);
  });
});
