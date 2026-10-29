import { describe, expect, it } from "vitest";
import { type DatosJsonLd, jsonLdDeLaCarta, jsonLdEnTexto } from "./json-ld.js";

const ORIGEN = "https://garumvinoteca.com";

const base: DatosJsonLd = {
  businessName: "Garum Vinoteca",
  tagline: null,
  origen: ORIGEN,
  ficha: null,
  idioma: null,
  currency: "EUR",
  bienvenida: false,
  categoria: null,
  secciones: [
    { slug: "vinos", name: "Vinos", productCount: 3 },
    { slug: "vacia", name: "Vacía", productCount: 0 },
  ],
  platos: [],
};

const FICHA = {
  street: "Calle Larios 5",
  postalCode: "29005",
  city: "Málaga",
  region: null,
  phone: "+34 952 000 000",
  openingHours: {
    mo: [],
    tu: [["13:00", "16:00"]] as [string, string][],
    sa: [["20:00", "02:00"]] as [string, string][],
  },
};

describe("jsonLdDeLaCarta", () => {
  it("siempre un Restaurant con nombre y URL; sin lema, sin descripción", () => {
    const ld = jsonLdDeLaCarta(base);
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: "Garum Vinoteca",
      url: `${ORIGEN}/`,
    });
    expect(ld).not.toHaveProperty("description");
  });

  it("nada que no esté en la página: ni valoraciones, ni rango de precios", () => {
    const ld = jsonLdDeLaCarta({ ...base, ficha: FICHA });
    for (const clave of ["aggregateRating", "review", "priceRange"]) {
      expect(ld).not.toHaveProperty(clave);
    }
  });

  it("sin ficha no hay dirección, ni teléfono, ni horario", () => {
    const ld = jsonLdDeLaCarta(base);
    expect(ld).not.toHaveProperty("address");
    expect(ld).not.toHaveProperty("telephone");
    expect(ld).not.toHaveProperty("openingHoursSpecification");
  });

  it("con ficha: dirección solo con lo guardado y el teléfono tal cual", () => {
    const ld = jsonLdDeLaCarta({ ...base, ficha: FICHA });
    expect(ld.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Calle Larios 5",
      postalCode: "29005",
      addressLocality: "Málaga",
    });
    expect(ld.telephone).toBe("+34 952 000 000");
  });

  it("un día cerrado no se declara, y un tramo que pasa de medianoche sale como dos", () => {
    const ld = jsonLdDeLaCarta({ ...base, ficha: FICHA });
    expect(ld.openingHoursSpecification).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Tuesday",
        opens: "13:00",
        closes: "16:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Saturday",
        opens: "20:00",
        closes: "23:59",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Sunday",
        opens: "00:00",
        closes: "02:00",
      },
    ]);
  });

  it("el domingo que pasa de medianoche sigue en lunes", () => {
    const ld = jsonLdDeLaCarta({
      ...base,
      ficha: { ...FICHA, openingHours: { su: [["22:00", "01:00"]] } },
    });
    expect(ld.openingHoursSpecification).toContainEqual(
      expect.objectContaining({ dayOfWeek: "Monday", opens: "00:00", closes: "01:00" }),
    );
  });

  it("en la bienvenida la carta no se ve: el menú es solo el enlace a ella", () => {
    expect(jsonLdDeLaCarta({ ...base, bienvenida: true }).hasMenu).toBe(`${ORIGEN}/?ver=carta`);
    expect(jsonLdDeLaCarta({ ...base, bienvenida: true, idioma: "en" }).hasMenu).toBe(
      `${ORIGEN}/?lang=en&ver=carta`,
    );
  });

  it("en la raíz de la carta, las secciones con algo dentro, con su URL sin mesa", () => {
    expect(jsonLdDeLaCarta(base).hasMenu).toEqual({
      "@type": "Menu",
      url: `${ORIGEN}/?ver=carta`,
      hasMenuSection: [{ "@type": "MenuSection", name: "Vinos", url: `${ORIGEN}/?cat=vinos` }],
    });
  });

  it("en una categoría, su sección con sus platos y precios", () => {
    const ld = jsonLdDeLaCarta({
      ...base,
      categoria: { slug: "tintos", nombre: "Tintos" },
      secciones: [],
      platos: [{ name: "Ribera del Duero", price: 18 }],
    });
    expect(ld.hasMenu).toEqual({
      "@type": "Menu",
      url: `${ORIGEN}/?cat=tintos`,
      hasMenuSection: [
        {
          "@type": "MenuSection",
          name: "Tintos",
          url: `${ORIGEN}/?cat=tintos`,
          hasMenuItem: [
            {
              "@type": "MenuItem",
              name: "Ribera del Duero",
              offers: { "@type": "Offer", price: "18.00", priceCurrency: "EUR" },
            },
          ],
        },
      ],
    });
  });
});

describe("jsonLdEnTexto", () => {
  it("no contiene </script> aunque un plato lo lleve en el nombre", () => {
    const texto = jsonLdEnTexto(
      jsonLdDeLaCarta({
        ...base,
        categoria: { slug: "x", nombre: "X" },
        platos: [{ name: "Tarta</script><script>alert(1)</script>", price: 5 }],
      }),
    );
    expect(texto).not.toContain("</script>");
    expect(texto).not.toContain("<");
    // Sigue siendo el mismo JSON: `<` es `<` al parsearlo.
    expect(JSON.stringify(JSON.parse(texto))).toContain("Tarta</script>");
  });
});
