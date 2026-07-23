import { describe, expect, it } from "vitest";
import { CATEGORIAS, DESCRIPCIONES, EXTRAS, fundirI18n, planear } from "./manuela-i18n.mjs";

describe("fundirI18n", () => {
  it("añade en/pt sin tocar el español que ya hay", () => {
    const out = fundirI18n({ es: "Tostadas" }, { en: "Toasts", pt: "Torradas" });
    expect(out).toEqual({ es: "Tostadas", en: "Toasts", pt: "Torradas" });
  });

  it("no reescribe si en/pt ya son los mismos (evita un update inútil)", () => {
    const actual = { es: "Tostadas", en: "Toasts", pt: "Torradas" };
    expect(fundirI18n(actual, { en: "Toasts", pt: "Torradas" })).toBeNull();
  });

  it("el español del mapa nunca pisa al de la base", () => {
    // El mapa no trae `es`, pero aun si lo trajera manda el de la fila.
    const out = fundirI18n({ es: "original" }, { es: "otro", en: "x", pt: "y" });
    expect(out.es).toBe("original");
  });
});

describe("planear", () => {
  const filas = [
    { id: "1", name_i18n: { es: "Tostadas" } },
    { id: "2", name_i18n: { es: "Desconocida" } }, // no está en el mapa
    { id: "3", name_i18n: { es: "Vinos", en: "Wines", pt: "Vinhos" } }, // ya traducida
  ];

  it("solo devuelve las filas que cambian y que están en el mapa", () => {
    const updates = planear(filas, "name_i18n", CATEGORIAS);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      id: "1",
      valor: { es: "Tostadas", en: "Toasts", pt: "Torradas" },
    });
  });
});

describe("cobertura del catálogo", () => {
  it("toda categoría traducida trae en y pt no vacíos", () => {
    for (const [es, t] of Object.entries(CATEGORIAS)) {
      expect(t.en?.trim(), `en de '${es}'`).toBeTruthy();
      expect(t.pt?.trim(), `pt de '${es}'`).toBeTruthy();
    }
  });

  it("toda descripción traducida trae en y pt no vacíos", () => {
    for (const [es, t] of Object.entries(DESCRIPCIONES)) {
      expect(t.en?.trim(), `en de '${es.slice(0, 30)}'`).toBeTruthy();
      expect(t.pt?.trim(), `pt de '${es.slice(0, 30)}'`).toBeTruthy();
    }
  });

  it("todo extra traducido trae en y pt no vacíos", () => {
    for (const [es, t] of Object.entries(EXTRAS)) {
      expect(t.en?.trim(), `en de '${es}'`).toBeTruthy();
      expect(t.pt?.trim(), `pt de '${es}'`).toBeTruthy();
    }
  });
});
