import { describe, expect, it } from "vitest";
import { InvalidCatalogActionInputError, parseFranja } from "./catalog-action-input";

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

describe("parseFranja", () => {
  it("sin los campos, no toca la franja", () => {
    // Distinto de "quítala": si fueran lo mismo, cualquier otro formulario que editara la
    // categoría le borraría la franja sin mencionarlo.
    expect(parseFranja(form({ name_es: "Cenas" }))).toBeUndefined();
  });

  it("las dos en blanco la quitan", () => {
    expect(parseFranja(form({ visible_desde: "", visible_hasta: "" }))).toEqual({
      visibleDesde: null,
      visibleHasta: null,
    });
  });

  it("las dos horas se aceptan tal cual", () => {
    expect(parseFranja(form({ visible_desde: "20:00", visible_hasta: "02:00" }))).toEqual({
      visibleDesde: "20:00",
      visibleHasta: "02:00",
    });
  });

  it("media franja se rechaza con un mensaje que se entiende", () => {
    // El CHECK de la base también lo impide, pero ahí llega como un 500 sin texto útil.
    const acto = () => parseFranja(form({ visible_desde: "20:00", visible_hasta: "" }));
    expect(acto).toThrow(InvalidCatalogActionInputError);
    expect(acto).toThrow(/las dos horas/);
  });

  it("la misma hora en las dos se rechaza", () => {
    // "De 12:00 a 12:00" no significa nada obvio: ¿24 horas o ninguna?
    expect(() => parseFranja(form({ visible_desde: "12:00", visible_hasta: "12:00" }))).toThrow(
      InvalidCatalogActionInputError,
    );
  });

  it("una hora que no es una hora se rechaza", () => {
    expect(() => parseFranja(form({ visible_desde: "25:00", visible_hasta: "02:00" }))).toThrow(
      /HH:MM/,
    );
    expect(() => parseFranja(form({ visible_desde: "abc", visible_hasta: "02:00" }))).toThrow(
      /HH:MM/,
    );
  });
});
