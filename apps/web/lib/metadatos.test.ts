import { describe, expect, it } from "vitest";
import { type DatosDeLaCarta, metadatosDeLaCarta } from "./metadatos.js";

const ORIGEN = "https://garumvinoteca.com";

const base: DatosDeLaCarta = {
  businessName: "Garum Vinoteca",
  tagline: "Vinos y tapas en el centro",
  lang: "es",
  porDefecto: "es",
  idiomas: ["es"],
  categoria: null,
  origen: ORIGEN,
  heroUrl: null,
};

describe("metadatosDeLaCarta", () => {
  it("en la raíz, el título es el nombre y «Carta», sin pasar por la plantilla del layout", () => {
    expect(metadatosDeLaCarta(base).title).toEqual({ absolute: "Garum Vinoteca · Carta" });
  });

  it("dentro de una categoría, el título es la categoría y el nombre", () => {
    const m = metadatosDeLaCarta({ ...base, categoria: { slug: "tapas", nombre: "Tapas" } });
    expect(m.title).toEqual({ absolute: "Tapas · Garum Vinoteca" });
  });

  it("la palabra «Carta» va en el idioma de la página", () => {
    const m = metadatosDeLaCarta({ ...base, lang: "en", idiomas: ["es", "en"] });
    expect(m.title).toEqual({ absolute: "Garum Vinoteca · Menu" });
  });

  it("sin lema no hay descripción, ni en la página ni en la vista previa", () => {
    const m = metadatosDeLaCarta({ ...base, tagline: null });
    expect(m).not.toHaveProperty("description");
    expect(m.openGraph).not.toHaveProperty("description");
  });

  it("con lema, es la descripción", () => {
    const m = metadatosDeLaCarta(base);
    expect(m.description).toBe("Vinos y tapas en el centro");
    expect(m.openGraph?.description).toBe("Vinos y tapas en el centro");
  });

  it("el canonical de /7?cat=tapas es {origen}/?cat=tapas: la mesa no cuenta", () => {
    // La función no recibe la mesa: es lo que garantiza que /7 y / compartan canonical.
    const m = metadatosDeLaCarta({ ...base, categoria: { slug: "tapas", nombre: "Tapas" } });
    expect(m.alternates?.canonical).toBe(`${ORIGEN}/?cat=tapas`);
    expect(m.openGraph).toMatchObject({ url: `${ORIGEN}/?cat=tapas`, type: "website" });
  });

  it("en la raíz, el canonical es {origen}/", () => {
    expect(metadatosDeLaCarta(base).alternates?.canonical).toBe(`${ORIGEN}/`);
  });

  it("en otro idioma, el canonical conserva el idioma", () => {
    const m = metadatosDeLaCarta({
      ...base,
      lang: "en",
      idiomas: ["es", "en"],
      categoria: { slug: "tapas", nombre: "Tapas" },
    });
    expect(m.alternates?.canonical).toBe(`${ORIGEN}/?cat=tapas&lang=en`);
  });

  it("solo salen los idiomas disponibles, y el del cliente sin ?lang=", () => {
    const m = metadatosDeLaCarta({ ...base, idiomas: ["es", "en"] });
    expect(m.alternates?.languages).toEqual({
      es: `${ORIGEN}/`,
      en: `${ORIGEN}/?lang=en`,
    });
  });

  it("con un solo idioma no hay alternativas que anunciar", () => {
    expect(metadatosDeLaCarta(base).alternates).not.toHaveProperty("languages");
  });

  it("sin foto de bienvenida no hay imágenes", () => {
    expect(metadatosDeLaCarta(base).openGraph).not.toHaveProperty("images");
  });

  it("la foto de bienvenida va como URL absoluta, sea de storage o de public/", () => {
    const storage = "https://api.suarex.app/storage/v1/object/public/catalog/garum/hero.jpg";
    expect(metadatosDeLaCarta({ ...base, heroUrl: storage }).openGraph?.images).toEqual([storage]);
    expect(
      metadatosDeLaCarta({ ...base, heroUrl: "/brands/garum-fondo.png" }).openGraph?.images,
    ).toEqual([`${ORIGEN}/brands/garum-fondo.png`]);
  });
});
