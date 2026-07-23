import { describe, expect, it } from "vitest";
import { availableLangs, pickI18n, resolveLang } from "./i18n";

/**
 * El idioma decide QUÉ LEE el comensal. Sus fallos son silenciosos: no revientan la carta,
 * la dejan a medias -- un plato sin nombre, un selector que promete una traducción que no
 * existe, o un `?lang=` manipulado que tumba la página.
 */

describe("resolveLang", () => {
  it("respeta el idioma pedido en la URL", () => {
    expect(resolveLang("en", "es")).toBe("en");
  });

  it("un idioma desconocido o manipulado cae al del cliente, sin romper la carta", () => {
    expect(resolveLang("klingon", "pt")).toBe("pt");
    expect(resolveLang({ raro: true }, "pt")).toBe("pt");
    expect(resolveLang(undefined, "en")).toBe("en");
  });

  it("sin idioma pedido ni configurado, español", () => {
    expect(resolveLang(undefined, undefined)).toBe("es");
    // Un `locale` del cliente que no sabemos pintar tampoco puede dejar la carta en blanco.
    expect(resolveLang(undefined, "fr")).toBe("es");
  });
});

describe("pickI18n", () => {
  const CAFE = { es: "Café con leche", en: "Latte" };

  it("devuelve el texto del idioma elegido", () => {
    expect(pickI18n(CAFE, "en")).toBe("Latte");
  });

  it("sin traducción, cae al idioma de partida", () => {
    // De los 145 platos de Manuela solo una parte están traducidos: los que no, deben
    // seguir viéndose. Un plato sin nombre es peor que un plato en otro idioma.
    expect(pickI18n(CAFE, "pt")).toBe("Café con leche");
  });

  it("sin idioma de partida tampoco, coge cualquier traducción que exista", () => {
    expect(pickI18n({ pt: "Bica" }, "en")).toBe("Bica");
  });

  it("un texto vacío cuenta como ausente", () => {
    // Una traducción a medio hacer (cadena vacía o en blanco) dejaría el hueco pelado.
    expect(pickI18n({ es: "Tostada", en: "   " }, "en")).toBe("Tostada");
  });

  it("un campo que falta no revienta", () => {
    expect(pickI18n(undefined, "es")).toBe("");
  });
});

describe("availableLangs", () => {
  it("ofrece solo los idiomas que el cliente tiene de verdad", () => {
    // Ofrecer "EN" para acabar enseñando la carta en español es peor que no ofrecerlo.
    expect(availableLangs([{ es: "Cafés", en: "Coffee" }, { es: "Tostas" }], "es")).toEqual([
      "es",
      "en",
    ]);
  });

  it("el idioma del cliente siempre entra, aunque su catálogo esté sin traducir", () => {
    expect(availableLangs([], "pt")).toEqual(["pt"]);
  });

  it("ignora idiomas que la plataforma no sabe pintar", () => {
    expect(availableLangs([{ es: "Vinos", fr: "Vins" }], "es")).toEqual(["es"]);
  });

  it("una traducción en blanco no cuenta como idioma disponible", () => {
    expect(availableLangs([{ es: "Vinos", en: "" }], "es")).toEqual(["es"]);
  });

  it("los devuelve siempre en el mismo orden", () => {
    // El selector no puede bailar de sitio entre una pantalla y la siguiente.
    expect(availableLangs([{ pt: "Bica" }, { en: "Coffee" }], "es")).toEqual(["es", "en", "pt"]);
  });
});
