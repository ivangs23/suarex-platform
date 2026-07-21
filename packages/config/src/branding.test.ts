import { describe, expect, it } from "vitest";
import { brandingToCssVars, DEFAULT_BRANDING, parseBranding } from "./branding.js";

describe("parseBranding", () => {
  it("devuelve los defaults con una entrada vacía", () => {
    expect(parseBranding({})).toEqual(DEFAULT_BRANDING);
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
