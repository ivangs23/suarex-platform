import { describe, expect, it } from "vitest";
import { buildTicketLines } from "./build.js";
import type { TicketOrder } from "./types.js";

const order: TicketOrder = {
  orderNumber: 42,
  tableLabel: "5",
  createdAt: "2026-07-22T10:30:00.000Z",
  items: [
    { name: "Tosta de jamón", quantity: 2, destination: "cocina", extras: [] },
    { name: "Copa de vino", quantity: 1, destination: "barra", extras: [] },
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
