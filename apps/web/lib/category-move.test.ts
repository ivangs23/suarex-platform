import { describe, expect, it } from "vitest";
import { type CategoryParent, wouldCreateCycle } from "./category-move";

// Misma forma que la carta real de garum:
//   vinos ─ rioja ─ blancos
//                 └ tintos
//   cafes
const ARBOL: CategoryParent[] = [
  { id: "vinos", parentId: null },
  { id: "rioja", parentId: "vinos" },
  { id: "blancos", parentId: "rioja" },
  { id: "tintos", parentId: "rioja" },
  { id: "cafes", parentId: null },
];

describe("wouldCreateCycle", () => {
  it("permite mover a una rama que no cuelga de la categoría", () => {
    expect(wouldCreateCycle(ARBOL, "blancos", "cafes")).toBe(false);
    expect(wouldCreateCycle(ARBOL, "rioja", "cafes")).toBe(false);
  });

  it("permite sacar una categoría a la raíz", () => {
    // Dejar de colgar de nadie nunca puede cerrar un ciclo.
    expect(wouldCreateCycle(ARBOL, "blancos", null)).toBe(false);
    expect(wouldCreateCycle(ARBOL, "vinos", null)).toBe(false);
  });

  it("impide que una categoría sea su propio padre", () => {
    expect(wouldCreateCycle(ARBOL, "vinos", "vinos")).toBe(true);
  });

  it("impide colgarla de su propio hijo", () => {
    // vinos bajo rioja: rioja cuelga de vinos, así que la rama quedaría suelta.
    expect(wouldCreateCycle(ARBOL, "vinos", "rioja")).toBe(true);
  });

  it("impide colgarla de un descendiente lejano", () => {
    // El caso que un `parent_id === id` ingenuo NO detecta: vinos → rioja → blancos.
    expect(wouldCreateCycle(ARBOL, "vinos", "blancos")).toBe(true);
  });

  it("permite mover entre hermanos", () => {
    expect(wouldCreateCycle(ARBOL, "blancos", "tintos")).toBe(false);
  });

  it("rechaza colgar de una rama que YA tenía un ciclo, sin colgarse", () => {
    // Nada en la base impide que exista a → b → a de antes. Recorrerlo sin cortar sería un
    // bucle infinito; y colgar algo ahí lo dejaría igual de inalcanzable.
    const roto: CategoryParent[] = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "suelta", parentId: null },
    ];
    expect(wouldCreateCycle(roto, "suelta", "a")).toBe(true);
  });

  it("un padre que no existe se trata como raíz y no bloquea", () => {
    // Puede pasar si otra sesión borró la categoría entre la lectura y el envío: se deja
    // pasar y es la clave ajena de Postgres quien rechaza, no una comprobación a medias.
    expect(wouldCreateCycle(ARBOL, "cafes", "no-existe")).toBe(false);
  });
});
