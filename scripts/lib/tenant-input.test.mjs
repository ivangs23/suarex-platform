import { describe, expect, it } from "vitest";
import { validarEmail, validarIdioma, validarSlug } from "./tenant-input.mjs";

/**
 * Un alta va contra producción: un dato mal formado ahí rompe el subdominio del cliente o
 * crea un owner que no puede entrar. Estos tests fijan el borde ANTES de tocar la base.
 */
describe("validarSlug", () => {
  it("acepta minúsculas, números y guiones interiores", () => {
    expect(validarSlug("bar-paco")).toBe("bar-paco");
    expect(validarSlug("cafe2000")).toBe("cafe2000");
  });

  it("rechaza mayúsculas, espacios, acentos y guiones al borde", () => {
    for (const malo of ["Bar", "bar paco", "café", "-bar", "bar-", "bar--paco", ""]) {
      expect(() => validarSlug(malo), malo).toThrow(/Slug inválido/);
    }
  });

  it("rechaza un slug que no cabe en un subdominio", () => {
    expect(() => validarSlug("a".repeat(64))).toThrow(/demasiado largo/);
  });
});

describe("validarEmail", () => {
  it("acepta un email con forma válida y lo normaliza a minúsculas", () => {
    expect(validarEmail("Dueño@BarPaco.com")).toBe("dueño@barpaco.com");
  });

  it("rechaza lo que no tiene forma de email", () => {
    for (const malo of ["sin-arroba", "a@b", "a@b.", "@b.com", ""]) {
      expect(() => validarEmail(malo), malo).toThrow(/Email inválido/);
    }
  });
});

describe("validarIdioma", () => {
  it("acepta los que la plataforma sabe pintar", () => {
    expect(validarIdioma("pt")).toBe("pt");
  });
  it("rechaza uno que dejaría la carta a medias", () => {
    expect(() => validarIdioma("fr")).toThrow(/no soportado/);
  });
});
