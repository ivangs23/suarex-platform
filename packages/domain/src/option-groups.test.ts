import { describe, expect, it } from "vitest";
import type { OptionGroup } from "./option-groups.js";
import { isSelectionComplete, validateOptionGroups } from "./option-groups.js";

/** El caso de diario: una hamburguesa con UN punto de la carne obligatorio. */
const punto: OptionGroup = {
  id: "g-punto",
  name: "Punto de la carne",
  minSelect: 1,
  maxSelect: 1,
  optionIds: ["poco", "punto", "hecho"],
};

/** Un grupo que permite varias pero no obliga a ninguna: hasta dos salsas. */
const salsas: OptionGroup = {
  id: "g-salsas",
  name: "Salsas",
  minSelect: 0,
  maxSelect: 2,
  optionIds: ["brava", "alioli", "barbacoa"],
};

describe("validateOptionGroups", () => {
  it("sin grupos, cualquier selección vale", () => {
    expect(validateOptionGroups([], ["lo-que-sea"])).toEqual([]);
  });

  it("un grupo obligatorio sin elegir nada se queda corto", () => {
    expect(validateOptionGroups([punto], [])).toEqual([
      { groupId: "g-punto", groupName: "Punto de la carne", kind: "too-few", limit: 1, chosen: 0 },
    ]);
  });

  it("elegida la opción que pedía, no hay nada que objetar", () => {
    expect(validateOptionGroups([punto], ["punto"])).toEqual([]);
  });

  it("elegir dos donde solo cabe una se pasa", () => {
    expect(validateOptionGroups([punto], ["poco", "hecho"])).toEqual([
      { groupId: "g-punto", groupName: "Punto de la carne", kind: "too-many", limit: 1, chosen: 2 },
    ]);
  });

  it("un grupo opcional vacío no incumple nada", () => {
    expect(validateOptionGroups([salsas], [])).toEqual([]);
  });

  it("un grupo opcional también tiene tope", () => {
    expect(validateOptionGroups([salsas], ["brava", "alioli", "barbacoa"])).toEqual([
      { groupId: "g-salsas", groupName: "Salsas", kind: "too-many", limit: 2, chosen: 3 },
    ]);
  });

  it("devuelve TODAS las violaciones, no solo la primera", () => {
    const violaciones = validateOptionGroups(
      [punto, salsas],
      ["brava", "alioli", "barbacoa"], // ningún punto Y tres salsas
    );
    expect(violaciones.map((v) => v.groupId)).toEqual(["g-punto", "g-salsas"]);
  });

  it("una opción repetida cuenta UNA vez: no cumple un mínimo a base de marcarla dos veces", () => {
    const dosToppings: OptionGroup = {
      id: "g-top",
      name: "Toppings",
      minSelect: 2,
      maxSelect: 3,
      optionIds: ["aguacate", "mango"],
    };
    expect(validateOptionGroups([dosToppings], ["aguacate", "aguacate"])).toEqual([
      { groupId: "g-top", groupName: "Toppings", kind: "too-few", limit: 2, chosen: 1 },
    ]);
  });

  it("las opciones de OTRO grupo no cuentan para este", () => {
    // "brava" es una salsa; no puede servir para cumplir el punto de la carne.
    expect(validateOptionGroups([punto], ["brava"])).toEqual([
      { groupId: "g-punto", groupName: "Punto de la carne", kind: "too-few", limit: 1, chosen: 0 },
    ]);
  });

  it("los añadidos sueltos (sin grupo) no molestan a ningún grupo", () => {
    expect(validateOptionGroups([punto], ["punto", "extra-queso"])).toEqual([]);
  });

  it("un mínimo mayor que uno se cumple justo al llegar a él", () => {
    const dos: OptionGroup = {
      id: "g",
      name: "Dos guarniciones",
      minSelect: 2,
      maxSelect: 2,
      optionIds: ["a", "b", "c"],
    };
    expect(validateOptionGroups([dos], ["a"])[0]?.kind).toBe("too-few");
    expect(validateOptionGroups([dos], ["a", "b"])).toEqual([]);
    expect(validateOptionGroups([dos], ["a", "b", "c"])[0]?.kind).toBe("too-many");
  });
});

describe("isSelectionComplete", () => {
  it("resume lo mismo en un sí o un no", () => {
    expect(isSelectionComplete([punto], [])).toBe(false);
    expect(isSelectionComplete([punto], ["punto"])).toBe(true);
  });
});
