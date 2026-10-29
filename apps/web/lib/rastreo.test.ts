import { describe, expect, it } from "vitest";
import { platosPorCategoria, reglasDeRobots, urlsDelSitemap } from "./rastreo.js";

const ORIGEN = "https://garumvinoteca.com";

describe("reglasDeRobots", () => {
  it("en un cliente, todo abierto salvo lo privado, y su sitemap", () => {
    expect(reglasDeRobots(ORIGEN)).toEqual({
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/staff", "/api/", "/pedido/", "/m/", "/totem/"],
      },
      sitemap: `${ORIGEN}/sitemap.xml`,
    });
  });

  it("el token de la mesa (/m/) nunca se rastrea", () => {
    const { rules } = reglasDeRobots(ORIGEN);
    expect(Array.isArray(rules) ? null : rules.disallow).toContain("/m/");
  });

  it("los asistentes siguen la regla general: no hay reglas por rastreador", () => {
    expect(Array.isArray(reglasDeRobots(ORIGEN).rules)).toBe(false);
  });

  it("en el host de plataforma no hay nada que indexar, ni sitemap", () => {
    expect(reglasDeRobots(null)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("urlsDelSitemap", () => {
  const categorias = [
    { id: "vinos", slug: "vinos", parentId: null },
    { id: "tintos", slug: "tintos", parentId: "vinos" },
    { id: "blancos", slug: "blancos", parentId: "vinos" },
    { id: "postres", slug: "postres", parentId: null },
  ];
  const urls = (productos: { categoryId: string }[], cats = categorias) =>
    urlsDelSitemap({ origen: ORIGEN, categorias: cats, productos }).map((u) => u.url);

  it("la carta sin mesa, sus categorías con productos y las tres legales", () => {
    expect(urls([{ categoryId: "tintos" }, { categoryId: "postres" }])).toEqual([
      `${ORIGEN}/`,
      `${ORIGEN}/?cat=vinos`,
      `${ORIGEN}/?cat=tintos`,
      `${ORIGEN}/?cat=postres`,
      `${ORIGEN}/legal/privacidad`,
      `${ORIGEN}/legal/aviso-legal`,
      `${ORIGEN}/legal/condiciones`,
    ]);
  });

  it("una categoría sin nada que ver, ni ella ni en su subárbol, no sale", () => {
    expect(urls([{ categoryId: "tintos" }])).not.toContain(`${ORIGEN}/?cat=blancos`);
    expect(urls([{ categoryId: "tintos" }])).not.toContain(`${ORIGEN}/?cat=postres`);
  });

  it("ninguna URL es de una mesa ni de un QR", () => {
    for (const url of urls([{ categoryId: "tintos" }])) {
      expect(new URL(url).pathname).toMatch(/^\/($|legal\/)/);
    }
  });

  it("los platos de una categoría cuentan su subárbol, como en la carta", () => {
    const platos = platosPorCategoria(categorias, [
      { categoryId: "tintos" },
      { categoryId: "tintos" },
      { categoryId: "blancos" },
    ]);
    expect(Object.fromEntries(platos)).toEqual({ vinos: 3, tintos: 2, blancos: 1, postres: 0 });
  });

  it("un ciclo de parent_id no cuelga el sitemap", () => {
    const ciclo = [
      { id: "a", slug: "a", parentId: "b" },
      { id: "b", slug: "b", parentId: "a" },
    ];
    expect(urls([], ciclo)).toEqual([
      `${ORIGEN}/`,
      `${ORIGEN}/legal/privacidad`,
      `${ORIGEN}/legal/aviso-legal`,
      `${ORIGEN}/legal/condiciones`,
    ]);
  });
});
