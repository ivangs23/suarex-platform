import { describe, expect, it } from "vitest";
import { buildTicketLines } from "./build.js";
import type { TicketOrder } from "./types.js";

const order: TicketOrder = {
  orderNumber: 42,
  tableLabel: "5",
  createdAt: "2026-07-22T10:30:00.000Z",
  items: [
    { name: "Tosta de jamón", quantity: 2, destination: "cocina", notes: null, extras: [] },
    { name: "Copa de vino", quantity: 1, destination: "barra", notes: null, extras: [] },
  ],
};
const branding = { header: "Bar Ejemplo" };

describe("buildTicketLines", () => {
  it("usa el header del tenant, no un literal", () => {
    const lines = buildTicketLines(order, branding, "cocina");
    const header = lines.find((l) => l.kind === "text" && l.bold && l.size === 2);
    expect(header && header.kind === "text" && header.text).toBe("Bar Ejemplo");
  });

  it("el ticket de cocina solo lleva los ítems de cocina", () => {
    const lines = buildTicketLines(order, branding, "cocina");
    const texts = lines
      .filter((l) => l.kind === "text")
      .map((l) => (l.kind === "text" ? l.text : ""));
    expect(texts.some((t) => t.includes("Tosta de jamon"))).toBe(true);
    expect(texts.some((t) => t.includes("Copa de vino"))).toBe(false);
  });

  it("el ticket de barra solo lleva los ítems de barra", () => {
    const lines = buildTicketLines(order, branding, "barra");
    const texts = lines
      .filter((l) => l.kind === "text")
      .map((l) => (l.kind === "text" ? l.text : ""));
    expect(texts.some((t) => t.includes("Copa de vino"))).toBe(true);
    expect(texts.some((t) => t.includes("Tosta"))).toBe(false);
  });

  it("termina en corte", () => {
    const lines = buildTicketLines(order, branding, "cocina");
    expect(lines.at(-1)?.kind).toBe("cut");
  });

  it("un destino sin ítems no revienta: header, aviso y corte", () => {
    const soloBarra: TicketOrder = { ...order, items: order.items.slice(1) };
    const lines = buildTicketLines(soloBarra, branding, "cocina");
    expect(lines.at(-1)?.kind).toBe("cut");
    const texts = lines
      .filter((l) => l.kind === "text")
      .map((l) => (l.kind === "text" ? l.text : ""));
    expect(texts.some((t) => /sin .*tems/i.test(t))).toBe(true);
  });

  it("sanea el nombre del ítem en la línea", () => {
    const lines = buildTicketLines(order, branding, "cocina");
    const texts = lines
      .filter((l) => l.kind === "text")
      .map((l) => (l.kind === "text" ? l.text : ""));
    expect(texts.some((t) => t.includes("Tosta de jamon"))).toBe(true);
  });
});

describe("la nota del comensal llega a la cocina", () => {
  /* Se guardaba en la base y no se imprimía nunca. Quien escribía "sin gluten" veía que se lo
     recogían y la cocina no se enteraba. Se descubrió pagando un pedido de verdad con una nota y
     leyendo los bytes que salieron por el cable. */
  const conNota: TicketOrder = {
    orderNumber: 7,
    tableLabel: "3",
    createdAt: "2026-08-03T12:00:00.000Z",
    items: [
      {
        name: "Tosta de jamón",
        quantity: 1,
        destination: "cocina",
        notes: "sin gluten, alergia severa",
        extras: ["Extra tomate"],
      },
    ],
  };

  const textos = (o: TicketOrder, destino: "cocina" | "barra" = "cocina") =>
    buildTicketLines(o, branding, destino)
      .filter((l) => l.kind === "text")
      .map((l) => (l.kind === "text" ? l : null));

  it("se imprime", () => {
    const t = textos(conNota).map((l) => l?.text ?? "");
    expect(t.some((x) => x.includes("sin gluten, alergia severa"))).toBe(true);
  });

  it("va en negrita: en una comanda de veinte líneas el texto plano se pasa por alto", () => {
    const nota = textos(conNota).find((l) => l?.text.includes("sin gluten"));
    expect(nota?.bold).toBe(true);
  });

  it("va pegada a SU plato y antes de las extras, no suelta al final", () => {
    const t = textos(conNota).map((l) => l?.text ?? "");
    const plato = t.findIndex((x) => x.includes("Tosta"));
    const nota = t.findIndex((x) => x.includes("sin gluten"));
    const extra = t.findIndex((x) => x.includes("Extra tomate"));
    expect(nota).toBe(plato + 1);
    expect(extra).toBeGreaterThan(nota);
  });

  it("sin nota no se cuela una línea vacía", () => {
    const sinNota: TicketOrder = {
      ...conNota,
      items: [{ name: "Tosta", quantity: 1, destination: "cocina", notes: null, extras: [] }],
    };
    const t = textos(sinNota).map((x) => x?.text ?? "");
    expect(t.some((x) => x.trim().startsWith(">>"))).toBe(false);
  });
});
