import { describe, expect, it } from "vitest";
import { objetoJson, textosJson } from "./json.js";

describe("objetoJson", () => {
  it("devuelve el objeto tal cual", () => {
    expect(objetoJson({ type: "usb", printerName: "EPSON" })).toEqual({
      type: "usb",
      printerName: "EPSON",
    });
  });

  it("cualquier otra cosa es un objeto vacío", () => {
    for (const valor of [null, undefined, "usb", 3, true, ["usb"]]) {
      expect(objetoJson(valor)).toEqual({});
    }
  });
});

describe("textosJson", () => {
  it("se queda con los textos por idioma", () => {
    expect(textosJson({ es: "Tosta", en: "Toast" })).toEqual({ es: "Tosta", en: "Toast" });
  });

  it("descarta lo que no es texto en vez de colarlo en la carta", () => {
    expect(textosJson({ es: "Tosta", en: null, pt: 3, fr: { x: "y" } })).toEqual({ es: "Tosta" });
  });

  it("un jsonb que no es objeto da un diccionario vacío", () => {
    expect(textosJson(null)).toEqual({});
    expect(textosJson("Tosta")).toEqual({});
  });
});
