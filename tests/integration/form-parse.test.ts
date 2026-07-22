import { describe, expect, it } from "vitest";
import {
  InvalidFormFieldError,
  optionalString,
  parseOptionalBoolean,
  parseOptionalInt,
  requiredString,
} from "../../apps/web/lib/form-parse.js";

/**
 * Fix round 2 (Finding 3): cubre los cuatro parsers genéricos de `FormData` que antes
 * estaban re-declarados en `catalogo/actions.ts`, `mesas/actions.ts` y
 * `dispositivos/actions.ts`, ahora consolidados en `apps/web/lib/form-parse.ts`. Ver el
 * docstring de ese módulo para el porqué de cada parser.
 */

function formDataWith(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

describe("requiredString", () => {
  it("control positivo: recorta espacios y devuelve el valor", () => {
    expect(requiredString(formDataWith({ name: "  Mesa 1  " }), "name")).toBe("Mesa 1");
  });

  it("rechaza un campo ausente", () => {
    expect(() => requiredString(new FormData(), "name")).toThrow(InvalidFormFieldError);
  });

  it("rechaza un campo vacío o solo espacios", () => {
    expect(() => requiredString(formDataWith({ name: "" }), "name")).toThrow(InvalidFormFieldError);
    expect(() => requiredString(formDataWith({ name: "   " }), "name")).toThrow(
      InvalidFormFieldError,
    );
  });
});

describe("optionalString", () => {
  it("control positivo: recorta espacios y devuelve el valor", () => {
    expect(optionalString(formDataWith({ label: "  Terraza  " }), "label")).toBe("Terraza");
  });

  it("un campo ausente o vacío devuelve undefined, nunca una cadena vacía", () => {
    expect(optionalString(new FormData(), "label")).toBeUndefined();
    expect(optionalString(formDataWith({ label: "" }), "label")).toBeUndefined();
    expect(optionalString(formDataWith({ label: "   " }), "label")).toBeUndefined();
  });
});

describe("parseOptionalInt", () => {
  it("control positivo: una cadena numérica se convierte en number", () => {
    expect(parseOptionalInt(formDataWith({ sort_order: "5" }), "sort_order")).toBe(5);
    expect(parseOptionalInt(formDataWith({ sort_order: "-3" }), "sort_order")).toBe(-3);
  });

  it("un campo ausente devuelve undefined", () => {
    expect(parseOptionalInt(new FormData(), "sort_order")).toBeUndefined();
  });

  it("rechaza un valor no numérico en vez de dejar pasar NaN", () => {
    expect(() => parseOptionalInt(formDataWith({ sort_order: "abc" }), "sort_order")).toThrow(
      InvalidFormFieldError,
    );
  });
});

describe("parseOptionalBoolean", () => {
  it("control positivo: 'true' produce true", () => {
    expect(parseOptionalBoolean(formDataWith({ is_active: "true" }), "is_active")).toBe(true);
  });

  it("'false' produce false", () => {
    expect(parseOptionalBoolean(formDataWith({ is_active: "false" }), "is_active")).toBe(false);
  });

  it("un campo ausente devuelve undefined", () => {
    expect(parseOptionalBoolean(new FormData(), "is_active")).toBeUndefined();
  });

  it("cualquier otro valor se trata como false, no lanza (mismo contrato que la implementación original)", () => {
    expect(parseOptionalBoolean(formDataWith({ is_active: "yes" }), "is_active")).toBe(false);
    expect(parseOptionalBoolean(formDataWith({ is_active: "1" }), "is_active")).toBe(false);
  });
});
