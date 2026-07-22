import { describe, expect, it } from "vitest";
import {
  brandingToCssVars,
  DEFAULT_BRANDING,
  isFontName,
  isHexColor,
  parseBranding,
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
  it("genera una declaración por color y fuente", () => {
    const css = brandingToCssVars(DEFAULT_BRANDING);
    expect(css).toContain(`--color-bg:${DEFAULT_BRANDING.colors.bg}`);
    expect(css).toContain(`--color-primary:${DEFAULT_BRANDING.colors.primary}`);
    expect(css).toContain(`--font-display:${DEFAULT_BRANDING.fonts.display}`);
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
      fonts: { display: "Georgia" },
    });
    expect(result.colors.bg).toBe("#ffffff");
    expect(result.colors.primary).toBe(DEFAULT_BRANDING.colors.primary);
    expect(result.fonts.display).toBe("Georgia");
    expect(result.fonts.body).toBe(DEFAULT_BRANDING.fonts.body);
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

  it("ningún payload hostil en colores/fuentes/logoUrl deja rastro en el CSS emitido", () => {
    for (const payload of HOSTILE_PAYLOADS) {
      const branding = parseBranding({
        colors: { bg: payload, fg: payload, primary: payload, accent: payload, muted: payload },
        fonts: { display: payload, body: payload },
        logoUrl: payload,
      });
      const css = brandingToCssVars(branding);
      for (const char of FORBIDDEN_CHARS) {
        expect(css.includes(char)).toBe(false);
      }
      // 5 colores + 2 fuentes = 7 declaraciones, exactamente 7 punto y coma.
      expect(css.split(";").length - 1).toBe(7);
    }
  });

  it("un payload mixto (campos válidos + hostiles) conserva lo válido y sigue siendo CSS seguro", () => {
    const branding = parseBranding({
      colors: { bg: "#ffffff", primary: "<script>alert(1)</script>" },
      fonts: { display: "Georgia", body: '"; } * {color:red} /*' },
      logoUrl: "javascript:alert(1)",
    });
    expect(branding.colors.bg).toBe("#ffffff");
    expect(branding.fonts.display).toBe("Georgia");
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

describe("isFontName", () => {
  it("acepta una fuente simple", () => {
    expect(isFontName("Inter, sans-serif")).toBe(true);
  });
  it("rechaza caracteres peligrosos", () => {
    expect(isFontName("a<b")).toBe(false);
    expect(isFontName("x".repeat(65))).toBe(false);
    expect(isFontName(123)).toBe(false);
  });
});
