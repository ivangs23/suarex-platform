import { describe, expect, it } from "vitest";
import { validarCanales, validarEmail, validarIdioma, validarSlug } from "./tenant-input.mjs";

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

describe("validarCanales", () => {
  it("por defecto se da de alta con el producto base", () => {
    expect(validarCanales("qr-mesa")).toEqual(["qr-mesa"]);
  });

  it("un cliente con carta y totem lleva los dos", () => {
    expect(validarCanales("qr-mesa,kiosko")).toEqual(["qr-mesa", "kiosko"]);
  });

  it("tolera espacios y no repite", () => {
    expect(validarCanales(" qr-mesa , kiosko , qr-mesa ")).toEqual(["qr-mesa", "kiosko"]);
  });

  it("una cadena vacía es un cliente sin canales, que es una configuración legítima", () => {
    // Un cliente dado de alta antes de decidir qué contrata. Se enciende luego desde Ajustes.
    expect(validarCanales("")).toEqual([]);
  });

  it("un canal mal escrito se RECHAZA, no se guarda", () => {
    /* Guardar "kiosco" con c dejaría el totem apagado sin que nada lo dijera, y el fallo
       aparecería el día de la instalación en el local. */
    expect(() => validarCanales("kiosco")).toThrow(/Canal desconocido/);
    expect(() => validarCanales("qr-mesa,inventado")).toThrow(/inventado/);
  });

  it("el mensaje dice cuáles valen, para no tener que ir a buscarlo", () => {
    expect(() => validarCanales("x")).toThrow(/qr-mesa/);
  });
});
