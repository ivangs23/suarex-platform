import { describe, expect, it } from "vitest";
import { type DatosLlms, textoLlms } from "./llms.js";

const ORIGEN = "https://garumvinoteca.com";

const base: DatosLlms = {
  businessName: "Garum Vinoteca",
  tagline: "Vinoteca & cocina de producto",
  origen: ORIGEN,
  lang: "es",
  categorias: [
    { id: "vinos", slug: "vinos", parentId: null, nombre: "Vinos" },
    { id: "tintos", slug: "tintos", parentId: "vinos", nombre: "Tintos" },
    { id: "blancos", slug: "blancos", parentId: "vinos", nombre: "Blancos" },
    { id: "postres", slug: "postres", parentId: null, nombre: "Postres" },
  ],
  productos: [{ categoryId: "tintos" }, { categoryId: "tintos" }, { categoryId: "postres" }],
  ficha: null,
};

describe("textoLlms", () => {
  it("nombre, lema, la carta por categorías con sus platos y cómo se pide", () => {
    expect(textoLlms(base)).toBe(
      [
        "# Garum Vinoteca",
        "",
        "> Vinoteca & cocina de producto",
        "",
        "## Carta",
        "",
        `- [Vinos](${ORIGEN}/?cat=vinos): 2 platos`,
        `  - [Tintos](${ORIGEN}/?cat=tintos): 2 platos`,
        `- [Postres](${ORIGEN}/?cat=postres): 1 plato`,
        "",
        "## Cómo se pide",
        "",
        `Se pide en la mesa, escaneando su código QR. La carta también se puede consultar fuera del local: ${ORIGEN}/`,
        "",
      ].join("\n"),
    );
  });

  it("sin ficha, nada de dirección, teléfono ni horario", () => {
    const texto = textoLlms(base);
    expect(texto).not.toContain("Dirección");
    expect(texto).not.toContain("Teléfono");
    expect(texto).not.toContain("Horario");
  });

  it("sin lema, no hay cita", () => {
    expect(textoLlms({ ...base, tagline: null })).not.toContain(">");
  });

  it("con ficha, lo que haya: dirección, teléfono y los días publicados", () => {
    const texto = textoLlms({
      ...base,
      ficha: {
        street: "Calle Larios 5",
        postalCode: "29005",
        city: "Málaga",
        region: null,
        phone: "+34 952 000 000",
        openingHours: { mo: [], sa: [["20:00", "02:00"]] },
      },
    });
    expect(texto).toContain("## Dirección\n\nCalle Larios 5, 29005 Málaga\n");
    expect(texto).toContain("## Teléfono\n\n+34 952 000 000\n");
    expect(texto).toContain("## Horario\n\n- Lunes: Cerrado\n- Sábado: 20:00–2:00\n");
    expect(texto).not.toContain("Martes");
  });

  it("en el idioma del cliente", () => {
    const texto = textoLlms({ ...base, lang: "en", tagline: null });
    expect(texto).toContain("## Menu");
    expect(texto).toContain("- [Postres](https://garumvinoteca.com/?cat=postres): 1 dish");
    expect(texto).toContain("## How to order");
  });

  it("un corchete en el nombre no rompe el enlace", () => {
    const texto = textoLlms({
      ...base,
      categorias: [{ id: "postres", slug: "postres", parentId: null, nombre: "Postres [caseros]" }],
    });
    expect(texto).toContain(`- [Postres \\[caseros\\]](${ORIGEN}/?cat=postres)`);
  });
});
