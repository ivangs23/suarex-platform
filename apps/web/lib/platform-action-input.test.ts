import { describe, expect, it } from "vitest";
import { InvalidFormFieldError } from "./form-parse";
import { parseNuevoCliente } from "./platform-action-input";

function fd(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
}

const VALIDO = {
  slug: "bar-paco",
  name: "Bar Paco",
  owner_email: "dueno@barpaco.com",
  theme: "generic",
  locale: "es",
  currency: "eur",
};

describe("parseNuevoCliente", () => {
  it("normaliza slug, correo y moneda", () => {
    const r = parseNuevoCliente(
      fd({ ...VALIDO, slug: "  BAR-PACO  ", owner_email: "Dueno@BarPaco.com" }),
    );
    expect(r.slug).toBe("bar-paco");
    expect(r.ownerEmail).toBe("dueno@barpaco.com");
    expect(r.currency).toBe("EUR");
  });

  it("rechaza un slug inválido en el borde, no lo arregla", () => {
    // El slug acaba siendo el subdominio del cliente para siempre: cambiarlo después obliga a
    // reimprimir los QR de todas sus mesas. Se rechaza, no se "limpia".
    for (const slug of ["Bar Paco", "bar_paco", "-paco", "ab", "bar.paco"]) {
      expect(() => parseNuevoCliente(fd({ ...VALIDO, slug })), slug).toThrow(InvalidFormFieldError);
    }
  });

  it("rechaza un slug reservado", () => {
    // `admin` colisionaría con la consola de plataforma.
    expect(() => parseNuevoCliente(fd({ ...VALIDO, slug: "admin" }))).toThrow(
      InvalidFormFieldError,
    );
  });

  it("rechaza un correo que no lo es", () => {
    for (const owner_email of ["sin-arroba", "a@b", "@b.com", "a b@c.com"]) {
      expect(() => parseNuevoCliente(fd({ ...VALIDO, owner_email })), owner_email).toThrow(
        InvalidFormFieldError,
      );
    }
  });

  it("exige los campos obligatorios", () => {
    for (const falta of ["slug", "name", "owner_email"]) {
      const campos = { ...VALIDO };
      delete (campos as Record<string, string>)[falta];
      expect(() => parseNuevoCliente(fd(campos)), falta).toThrow();
    }
  });
});
