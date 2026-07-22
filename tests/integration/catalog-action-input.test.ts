import { describe, expect, it } from "vitest";
import {
  InvalidCatalogActionInputError,
  parseAllergenId,
  parseAvailability,
} from "../../apps/web/lib/catalog-action-input.js";

/**
 * Fix round 1 (Finding 2): cubre los dos parsers que
 * `apps/web/app/admin/catalogo/actions.ts` aplica a campos de `formData` ANTES de tocar
 * la base de datos -- `deleteTenantAllergenAction` (`allergen_id`) y
 * `setProductAvailabilityAction` (`is_available`). Ver el docstring de
 * `apps/web/lib/catalog-action-input.ts` para el porqué de cada rechazo.
 */
describe("parseAllergenId", () => {
  it("control positivo: un entero positivo en forma de cadena se acepta tal cual", () => {
    expect(parseAllergenId("1")).toBe(1);
    expect(parseAllergenId("42")).toBe(42);
  });

  it("rechaza un allergen_id no numérico en vez de convertirlo en NaN", () => {
    expect(() => parseAllergenId("abc")).toThrow(InvalidCatalogActionInputError);
    expect(() => parseAllergenId("")).toThrow(InvalidCatalogActionInputError);
  });

  it("rechaza un allergen_id no entero", () => {
    expect(() => parseAllergenId("1.5")).toThrow(InvalidCatalogActionInputError);
  });

  it("rechaza cero y negativos", () => {
    expect(() => parseAllergenId("0")).toThrow(InvalidCatalogActionInputError);
    expect(() => parseAllergenId("-3")).toThrow(InvalidCatalogActionInputError);
  });
});

describe("parseAvailability", () => {
  it("control positivo: 'true' y 'false' se aceptan tal cual", () => {
    expect(parseAvailability("true")).toBe(true);
    expect(parseAvailability("false")).toBe(false);
  });

  it("rechaza un valor que no es exactamente 'true' ni 'false', en vez de tratarlo en silencio como false", () => {
    expect(() => parseAvailability("1")).toThrow(InvalidCatalogActionInputError);
    expect(() => parseAvailability("yes")).toThrow(InvalidCatalogActionInputError);
    expect(() => parseAvailability("")).toThrow(InvalidCatalogActionInputError);
    expect(() => parseAvailability("TRUE")).toThrow(InvalidCatalogActionInputError);
  });
});
