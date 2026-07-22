import { describe, expect, it } from "vitest";
import {
  parseBrandingFields,
  parseCurrency,
  parseFiscalFields,
  parseLocale,
} from "./settings-action-input";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("parseBrandingFields", () => {
  it("parsea nombre, colores y fuentes válidos", () => {
    const out = parseBrandingFields(
      fd({
        name: "Bar Manuela",
        color_bg: "#ffffff",
        color_fg: "#000000",
        color_primary: "#a88445",
        color_accent: "#1f1d1a",
        color_muted: "#d9d1bd",
        font_display: "Inter",
        font_body: "Georgia",
      }),
    );
    expect(out).toEqual({
      name: "Bar Manuela",
      colors: {
        bg: "#ffffff",
        fg: "#000000",
        primary: "#a88445",
        accent: "#1f1d1a",
        muted: "#d9d1bd",
      },
      fonts: { display: "Inter", body: "Georgia" },
    });
  });

  it("nombre vacío => null", () => {
    const out = parseBrandingFields(
      fd({
        color_bg: "#ffffff",
        color_fg: "#000000",
        color_primary: "#a88445",
        color_accent: "#1f1d1a",
        color_muted: "#d9d1bd",
        font_display: "Inter",
        font_body: "Georgia",
      }),
    );
    expect(out.name).toBeNull();
  });

  it("rechaza un color no-hex", () => {
    expect(() =>
      parseBrandingFields(
        fd({
          color_bg: "rojo",
          color_fg: "#000000",
          color_primary: "#a88445",
          color_accent: "#1f1d1a",
          color_muted: "#d9d1bd",
          font_display: "Inter",
          font_body: "Georgia",
        }),
      ),
    ).toThrow(/color/i);
  });

  it("rechaza una fuente con caracteres peligrosos", () => {
    expect(() =>
      parseBrandingFields(
        fd({
          color_bg: "#ffffff",
          color_fg: "#000000",
          color_primary: "#a88445",
          color_accent: "#1f1d1a",
          color_muted: "#d9d1bd",
          font_display: "a<b",
          font_body: "Georgia",
        }),
      ),
    ).toThrow(/fuente/i);
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
