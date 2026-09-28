import { describe, expect, it } from "vitest";
import { categoriaVisibleAhora, filtrarPorFranja, minutosEnZona } from "./franjas.js";

const enMinutos = (h: number, m = 0) => h * 60 + m;

describe("categoriaVisibleAhora", () => {
  it("sin franja definida, siempre visible", () => {
    expect(categoriaVisibleAhora(null, null, enMinutos(3))).toBe(true);
    expect(categoriaVisibleAhora(null, null, enMinutos(15))).toBe(true);
    // Media franja no debería poder guardarse (lo impide `categories_franja_completa`), pero si
    // llegara, "siempre visible" es la degradación buena: una carta de más, nunca una de menos.
    expect(categoriaVisibleAhora("08:00", null, enMinutos(3))).toBe(true);
  });

  it("franja normal: dentro sí, fuera no", () => {
    expect(categoriaVisibleAhora("08:00", "12:00", enMinutos(9))).toBe(true);
    expect(categoriaVisibleAhora("08:00", "12:00", enMinutos(13))).toBe(false);
    expect(categoriaVisibleAhora("08:00", "12:00", enMinutos(7, 59))).toBe(false);
  });

  it("los bordes: se entra al abrir y se sale al cerrar", () => {
    // Intervalo semiabierto. A las 08:00 en punto ya se ve el desayuno; a las 12:00 en punto ya
    // no, porque ahí empieza la carta de mediodía y las dos a la vez es peor que ninguna.
    expect(categoriaVisibleAhora("08:00", "12:00", enMinutos(8)), "justo al abrir").toBe(true);
    expect(categoriaVisibleAhora("08:00", "12:00", enMinutos(12)), "justo al cerrar").toBe(false);
  });

  it("franja que CRUZA MEDIANOCHE: 20:00-02:00", () => {
    // El caso que rompe `ini <= ahora && ahora < fin`: a la 01:00, 60 no está entre 1200 y 120.
    // Una carta de cena que desaparece a medianoche, en mitad del servicio, es el fallo más
    // visible posible.
    expect(categoriaVisibleAhora("20:00", "02:00", enMinutos(21)), "21:00").toBe(true);
    expect(categoriaVisibleAhora("20:00", "02:00", enMinutos(23, 59)), "23:59").toBe(true);
    expect(categoriaVisibleAhora("20:00", "02:00", enMinutos(0)), "00:00").toBe(true);
    expect(categoriaVisibleAhora("20:00", "02:00", enMinutos(1)), "01:00").toBe(true);
    expect(categoriaVisibleAhora("20:00", "02:00", enMinutos(2)), "02:00 cierra").toBe(false);
    expect(categoriaVisibleAhora("20:00", "02:00", enMinutos(3)), "03:00").toBe(false);
    expect(categoriaVisibleAhora("20:00", "02:00", enMinutos(15)), "15:00").toBe(false);
  });

  it("tolera segundos en la hora, que es como los devuelve Postgres", () => {
    expect(categoriaVisibleAhora("08:00:00", "12:00:00", enMinutos(9))).toBe(true);
  });
});

describe("minutosEnZona", () => {
  // 2026-06-15T12:30:00Z. En junio Madrid va +2 (CEST) y Canarias +1 (WEST).
  const instante = new Date("2026-06-15T12:30:00Z");

  it("cuenta la hora de la SEDE, no la del servidor", () => {
    expect(minutosEnZona(instante, "Europe/Madrid"), "14:30").toBe(enMinutos(14, 30));
    // La hora canaria es la razón de que esto exista: con la hora peninsular, un local de Las
    // Palmas vería aparecer la carta de cena una hora antes de lo que cree.
    expect(minutosEnZona(instante, "Atlantic/Canary"), "13:30").toBe(enMinutos(13, 30));
    expect(minutosEnZona(instante, "UTC"), "12:30").toBe(enMinutos(12, 30));
  });

  it("medianoche cuenta como 0, no como 1440", () => {
    // Con `hour12: false` hay versiones de ICU que devuelven "24" a medianoche; 1440 haría que
    // una franja nocturna se apagara justo en el peor momento.
    expect(minutosEnZona(new Date("2026-06-15T22:00:00Z"), "Europe/Madrid")).toBe(0);
  });
});

describe("filtrarPorFranja", () => {
  const cat = (
    id: string,
    parentId: string | null,
    visibleDesde: string | null = null,
    visibleHasta: string | null = null,
  ) => ({ id, parentId, visibleDesde, visibleHasta });

  it("una hija dentro de un padre fuera de hora también se oculta", () => {
    // Si no, ocultar "Cenas" dejaría "Cenas > Postres" colgando en la carta de mediodía,
    // pedible y sin contexto.
    const arbol = [cat("cenas", null, "20:00", "23:30"), cat("postres", "cenas")];
    const ids = filtrarPorFranja(arbol, enMinutos(13)).map((c) => c.id);
    expect(ids).toEqual([]);
  });

  it("la herencia es transitiva (nieta de un padre oculto)", () => {
    const arbol = [
      cat("cenas", null, "20:00", "23:30"),
      cat("postres", "cenas"),
      cat("helados", "postres"),
    ];
    expect(filtrarPorFranja(arbol, enMinutos(13))).toEqual([]);
    expect(filtrarPorFranja(arbol, enMinutos(21)).map((c) => c.id)).toEqual([
      "cenas",
      "postres",
      "helados",
    ]);
  });

  it("una hermana sin franja no se ve arrastrada", () => {
    const arbol = [cat("desayunos", null, "08:00", "12:00"), cat("bebidas", null)];
    expect(filtrarPorFranja(arbol, enMinutos(13)).map((c) => c.id)).toEqual(["bebidas"]);
  });

  it("una huérfana (padre ausente de la lista) se trata como raíz", () => {
    // Una categoría de más es un defecto cosmético; una carta vacía es una venta perdida.
    const ids = filtrarPorFranja([cat("suelta", "no-existe")], enMinutos(13)).map((c) => c.id);
    expect(ids).toEqual(["suelta"]);
  });

  it("un ciclo en los datos no cuelga el render", () => {
    // La FK auto-referenciada no impide A -> B -> A. Colgar la carta sería peor que pintar de más.
    const arbol = [cat("a", "b"), cat("b", "a")];
    expect(() => filtrarPorFranja(arbol, enMinutos(13))).not.toThrow();
  });
});
