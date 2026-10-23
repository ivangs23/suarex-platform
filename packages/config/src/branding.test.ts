import { describe, expect, it } from "vitest";
import {
  brandingToCssVars,
  DEFAULT_BRANDING,
  isFontFamily,
  isHexColor,
  LAYOUT_OPTIONS,
  parseBranding,
  TOKEN_OPTIONS,
} from "./branding.js";

describe("parseBranding", () => {
  it("devuelve los defaults con una entrada vacía", () => {
    expect(parseBranding({})).toEqual(DEFAULT_BRANDING);
  });

  it("acepta un name válido", () => {
    expect(parseBranding({ name: "Bar Manuela" }).name).toBe("Bar Manuela");
  });

  it("degrada un name ausente a null", () => {
    expect(parseBranding({}).name).toBeNull();
  });

  it("degrada un name no-string a null", () => {
    expect(parseBranding({ name: 123 }).name).toBeNull();
  });

  it("degrada un name demasiado largo a null", () => {
    expect(parseBranding({ name: "x".repeat(81) }).name).toBeNull();
  });

  it("recorta los espacios de un name válido", () => {
    expect(parseBranding({ name: "  Garum  " }).name).toBe("Garum");
  });

  it("mezcla colores parciales sin perder el resto", () => {
    const result = parseBranding({ colors: { primary: "#7b4f96" } });
    expect(result.colors.primary).toBe("#7b4f96");
    expect(result.colors.bg).toBe(DEFAULT_BRANDING.colors.bg);
  });

  it("descarta un color con formato inválido y usa el default", () => {
    const result = parseBranding({ colors: { primary: "rojo chillón" } });
    expect(result.colors.primary).toBe(DEFAULT_BRANDING.colors.primary);
  });

  it("no lanza con basura", () => {
    expect(() => parseBranding(null)).not.toThrow();
    expect(parseBranding("texto")).toEqual(DEFAULT_BRANDING);
  });

  it("acepta logoUrl", () => {
    expect(parseBranding({ logoUrl: "https://cdn/x.png" }).logoUrl).toBe("https://cdn/x.png");
  });
});

describe("brandingToCssVars", () => {
  it("genera una declaración por color, fuente y token", () => {
    const css = brandingToCssVars(DEFAULT_BRANDING);
    expect(css).toContain(`--color-bg:${DEFAULT_BRANDING.colors.bg}`);
    expect(css).toContain(`--color-primary:${DEFAULT_BRANDING.colors.primary}`);
    // Las fuentes salen como la pila de la familia cargada, no como un nombre suelto.
    expect(css).toContain("--font-display:var(--font-playfair), Georgia, serif");
    expect(css).toContain("--font-body:var(--font-inter), system-ui, sans-serif");
    expect(css).toContain("--radius-card:0.75rem");
    expect(css).toContain("--shadow-card:none");
  });

  it("sin superficie propia, la deriva del color tenue como el genérico de siempre", () => {
    expect(brandingToCssVars(DEFAULT_BRANDING)).toContain(
      "--color-surface:color-mix(in srgb, var(--color-muted) 45%, transparent)",
    );
    expect(brandingToCssVars(parseBranding({ tokens: { surface: "#ffffff" } }))).toContain(
      "--color-surface:#ffffff",
    );
  });

  it("cada token se traduce a su valor CSS", () => {
    const css = brandingToCssVars(
      parseBranding({
        tokens: {
          radius: "lg",
          controlRadius: "rounded",
          shadow: "medium",
          border: "thick",
          spacing: "comfortable",
          titles: "uppercase",
          imageFit: "contain",
          thumb: "md",
        },
      }),
    );
    expect(css).toContain("--radius-card:1rem");
    expect(css).toContain("--radius-control:0.9rem");
    expect(css).toContain("--shadow-card:0 4px 6px -1px rgba(0, 0, 0, 0.1)");
    expect(css).toContain("--border-card:2px");
    expect(css).toContain("--space-card:1.4rem 1.5rem");
    expect(css).toContain("--title-transform:uppercase");
    expect(css).toContain("--image-fit:contain");
    expect(css).toContain("--thumb-size:88px");
  });

  it("ni la textura ni la insignia llegan al <style>: llevan URL y texto libre", () => {
    const css = brandingToCssVars(
      parseBranding({
        background: { imageUrl: "/brands/garum-pattern.svg", sizePx: 150 },
        badge: { emoji: "☕", color: "#1b4d3e" },
      }),
    );
    expect(css).not.toContain("garum-pattern");
    expect(css).not.toContain("☕");
  });

  it("no emite comillas ni punto y coma sueltos que rompan el atributo style", () => {
    const css = brandingToCssVars(parseBranding({ colors: { primary: "#123456" } }));
    expect(css).not.toContain('"');
    expect(css.endsWith(";")).toBe(true);
  });
});

// --- Regresiones del reviewer (findings 1-4) ---

describe("parseBranding — finding 1: nunca debe lanzar", () => {
  it("no lanza cuando una propiedad de nivel superior es un getter que lanza", () => {
    const hostile = {
      get colors() {
        throw new Error("boom");
      },
    };
    expect(() => parseBranding(hostile)).not.toThrow();
    expect(parseBranding(hostile)).toEqual(DEFAULT_BRANDING);
  });

  it("no lanza cuando una propiedad anidada es un getter que lanza", () => {
    const hostile = {
      colors: {
        get bg() {
          throw new Error("boom");
        },
        fg: "#000000",
      },
    };
    expect(() => parseBranding(hostile)).not.toThrow();
    const result = parseBranding(hostile);
    expect(result.colors.bg).toBe(DEFAULT_BRANDING.colors.bg);
    expect(result.colors.fg).toBe("#000000");
  });
});

describe("parseBranding — finding 2: degradación por campo, no todo o nada", () => {
  it("conserva bg válido y fonts.display válido aunque colors.primary sea inválido", () => {
    const result = parseBranding({
      colors: { bg: "#ffffff", primary: "not-a-color" },
      fonts: { display: "inter" },
    });
    expect(result.colors.bg).toBe("#ffffff");
    expect(result.colors.primary).toBe(DEFAULT_BRANDING.colors.primary);
    expect(result.fonts.display).toBe("inter");
    expect(result.fonts.body).toBe(DEFAULT_BRANDING.fonts.body);
  });

  it("una fuente que no es de las cargadas cae al default (las de texto libre de antes)", () => {
    // El seed guardaba "Playfair Display": nunca se pintó, y el genérico ya usaba Playfair.
    const result = parseBranding({ fonts: { display: "Playfair Display", body: "Georgia" } });
    expect(result.fonts).toEqual(DEFAULT_BRANDING.fonts);
  });
});

describe("parseBranding — tokens y ejes de layout", () => {
  it("los defaults son lo que pinta hoy el genérico", () => {
    expect(DEFAULT_BRANDING.fonts).toEqual({ display: "playfair", body: "inter" });
    // El default de cada eje es el primer valor de su lista.
    for (const [eje, valores] of Object.entries(LAYOUT_OPTIONS)) {
      expect(DEFAULT_BRANDING.layout[eje as keyof typeof LAYOUT_OPTIONS]).toBe(valores[0]);
    }
    for (const [token, valores] of Object.entries(TOKEN_OPTIONS)) {
      expect(DEFAULT_BRANDING.tokens[token as keyof typeof TOKEN_OPTIONS]).toBe(valores[0]);
    }
    expect(DEFAULT_BRANDING.tokens.surface).toBeNull();
  });

  it("acepta cada valor permitido de cada eje", () => {
    for (const [eje, valores] of Object.entries(LAYOUT_OPTIONS)) {
      for (const valor of valores) {
        const layout = parseBranding({ layout: { [eje]: valor } }).layout;
        expect(layout[eje as keyof typeof LAYOUT_OPTIONS]).toBe(valor);
      }
    }
  });

  it("un valor desconocido cae a su default y no arrastra a los demás", () => {
    const result = parseBranding({
      layout: { products: "carrusel", welcome: "poster" },
      tokens: { shadow: "brutal", radius: "lg", surface: "verde" },
    });
    expect(result.layout.products).toBe(DEFAULT_BRANDING.layout.products);
    expect(result.layout.welcome).toBe("poster");
    expect(result.tokens.shadow).toBe(DEFAULT_BRANDING.tokens.shadow);
    expect(result.tokens.radius).toBe("lg");
    expect(result.tokens.surface).toBeNull();
  });

  it("la textura: imagen y tamaño, cada uno con su default", () => {
    expect(
      parseBranding({ background: { imageUrl: "/brands/manuela-terrazo.png", sizePx: 300 } })
        .background,
    ).toEqual({ imageUrl: "/brands/manuela-terrazo.png", sizePx: 300 });
    expect(parseBranding({ background: { sizePx: 5000 } }).background).toEqual(
      DEFAULT_BRANDING.background,
    );
  });
});

describe("parseBranding — assets de /brands/", () => {
  it("acepta una imagen de /brands/ en logo, bienvenida y textura", () => {
    const result = parseBranding({
      logoUrl: "/brands/garum-logo.png",
      heroUrl: "/brands/manuela-fondo.png",
      background: { imageUrl: "/brands/garum-pattern.svg" },
    });
    expect(result.logoUrl).toBe("/brands/garum-logo.png");
    expect(result.heroUrl).toBe("/brands/manuela-fondo.png");
    expect(result.background.imageUrl).toBe("/brands/garum-pattern.svg");
  });

  it("rechaza cualquier otra ruta relativa o una que intente salir de la carpeta", () => {
    for (const ruta of [
      "/brands/../.env",
      "/brands/sub/x.png",
      "//evil.example.com/x.png",
      "/otra/x.png",
      "/brands/x.html",
      "/brands/X.PNG",
      "brands/x.png",
    ]) {
      expect(parseBranding({ logoUrl: ruta }).logoUrl, ruta).toBe(DEFAULT_BRANDING.logoUrl);
    }
  });
});

describe("parseBranding — lema e insignia", () => {
  it("el lema se guarda por idioma y descarta lo que no es texto o no es un idioma", () => {
    expect(
      parseBranding({
        tagline: {
          es: "  Vinoteca & cocina de producto  ",
          en: "Wine bar & produce-led kitchen",
          pt: 3,
          espanol: "no es un código",
          fr: "x".repeat(121),
        },
      }).tagline,
    ).toEqual({ es: "Vinoteca & cocina de producto", en: "Wine bar & produce-led kitchen" });
    expect(parseBranding({ tagline: "un texto suelto" }).tagline).toEqual({});
  });

  it("la insignia es entera o nada", () => {
    expect(parseBranding({ badge: { emoji: "☕", color: "#1b4d3e" } }).badge).toEqual({
      emoji: "☕",
      color: "#1b4d3e",
    });
    expect(parseBranding({ badge: { emoji: "☕" } }).badge).toBeNull();
    expect(parseBranding({ badge: { emoji: "☕", color: "verde" } }).badge).toBeNull();
    expect(parseBranding({ badge: { emoji: "un texto largo", color: "#000" } }).badge).toBeNull();
  });
});

describe("parseBranding — finding 3: logoUrl solo admite http/https", () => {
  it("rechaza javascript: y cae al default", () => {
    expect(parseBranding({ logoUrl: "javascript:alert(1)" }).logoUrl).toBe(
      DEFAULT_BRANDING.logoUrl,
    );
  });

  it("rechaza data: y cae al default", () => {
    expect(parseBranding({ logoUrl: "data:text/html,<script>alert(1)</script>" }).logoUrl).toBe(
      DEFAULT_BRANDING.logoUrl,
    );
  });

  it("acepta https absoluto", () => {
    expect(parseBranding({ logoUrl: "https://cdn.example.com/x.png" }).logoUrl).toBe(
      "https://cdn.example.com/x.png",
    );
  });

  it("acepta http absoluto", () => {
    expect(parseBranding({ logoUrl: "http://cdn.example.com/x.png" }).logoUrl).toBe(
      "http://cdn.example.com/x.png",
    );
  });
});

describe("parseBranding — finding 4: undefined explícito no debe pisar el default", () => {
  it("colors.bg explícitamente undefined cae al default, no se propaga como 'undefined'", () => {
    const result = parseBranding({ colors: { bg: undefined, fg: "#000000" } });
    expect(result.colors.bg).toBe(DEFAULT_BRANDING.colors.bg);
    expect(result.colors.fg).toBe("#000000");
    const css = brandingToCssVars(result);
    expect(css).not.toContain("undefined");
  });
});

describe("brandingToCssVars — límite de seguridad ante payloads hostiles", () => {
  const FORBIDDEN_CHARS = ["<", ">", '"', "'", "`", "}"];
  const HOSTILE_PAYLOADS = [
    "</style><script>alert(1)</script>",
    '"; } body{background:red} /*',
    "`" + "alert(1)" + "`",
    "red; } * {outline:9999px solid red} /*",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "'; color:red; --x:'",
    "<img src=x onerror=alert(1)>",
    'Arial", "onmouseover="alert(1)',
    "Arial}body{background:url(javascript:alert(1))}",
  ];

  it("ningún payload hostil en colores/fuentes/tokens/ejes/imágenes deja rastro en el CSS emitido", () => {
    for (const payload of HOSTILE_PAYLOADS) {
      const branding = parseBranding({
        colors: { bg: payload, fg: payload, primary: payload, accent: payload, muted: payload },
        fonts: { display: payload, body: payload },
        logoUrl: payload,
        tokens: Object.fromEntries(
          [...Object.keys(TOKEN_OPTIONS), "surface"].map((token) => [token, payload]),
        ),
        layout: Object.fromEntries(Object.keys(LAYOUT_OPTIONS).map((eje) => [eje, payload])),
        background: { imageUrl: payload, sizePx: payload },
        tagline: { es: payload },
        badge: { emoji: payload, color: payload },
      });
      const css = brandingToCssVars(branding);
      for (const char of FORBIDDEN_CHARS) {
        expect(css.includes(char)).toBe(false);
      }
      // 6 colores (con la superficie) + 2 fuentes + 8 tokens = 16 declaraciones, exactamente
      // 16 punto y coma: un payload que colara uno de más habría abierto otra regla.
      expect(css.split(";").length - 1).toBe(16);
    }
  });

  it("un payload mixto (campos válidos + hostiles) conserva lo válido y sigue siendo CSS seguro", () => {
    const branding = parseBranding({
      colors: { bg: "#ffffff", primary: "<script>alert(1)</script>" },
      fonts: { display: "system", body: '"; } * {color:red} /*' },
      logoUrl: "javascript:alert(1)",
    });
    expect(branding.colors.bg).toBe("#ffffff");
    expect(branding.fonts.display).toBe("system");
    expect(branding.logoUrl).toBe(DEFAULT_BRANDING.logoUrl);

    const css = brandingToCssVars(branding);
    for (const char of FORBIDDEN_CHARS) {
      expect(css.includes(char)).toBe(false);
    }
  });
});

describe("isHexColor", () => {
  it("acepta #abc y #aabbcc", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#AABBCC")).toBe(true);
  });
  it("rechaza no-hex", () => {
    expect(isHexColor("rojo")).toBe(false);
    expect(isHexColor("#12")).toBe(false);
    expect(isHexColor(123)).toBe(false);
  });
});

describe("isFontFamily", () => {
  it("acepta solo las familias que carga la app", () => {
    expect(isFontFamily("playfair")).toBe(true);
    expect(isFontFamily("inter")).toBe(true);
    expect(isFontFamily("system")).toBe(true);
  });
  it("rechaza cualquier otro nombre, aunque sea una fuente real", () => {
    expect(isFontFamily("Inter, sans-serif")).toBe(false);
    expect(isFontFamily("a<b")).toBe(false);
    expect(isFontFamily(123)).toBe(false);
  });
});
