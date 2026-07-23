import type { OrderReceipt } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { strings } from "@/lib/i18n";
import { filasRecibo, nombreArchivoRecibo } from "./receipt-pdf";

const receipt: OrderReceipt = {
  orderNumber: 2,
  createdAt: "2026-07-23T23:37:53.147Z",
  tableLabel: "1",
  totalCents: 1000,
  currency: "EUR",
  lines: [
    {
      id: "a",
      name: "La Antioxidante Pro",
      quantity: 1,
      lineTotalCents: 550,
      notes: "Sin cebolla",
      extras: [{ name: "Pan sin gluten", priceCents: 50 }],
    },
    { id: "b", name: "La Omega Vita", quantity: 1, lineTotalCents: 450, notes: null, extras: [] },
  ],
};

const opts = {
  businessName: "Manuela Desayuna",
  fecha: "23/7/2026",
  strings: strings("es"),
  formatearDinero: (cents: number) => `${(cents / 100).toFixed(2)} €`,
};

describe("nombreArchivoRecibo", () => {
  it("nombra el archivo por el número de pedido", () => {
    expect(nombreArchivoRecibo(2)).toBe("recibo-2.pdf");
  });
});

describe("filasRecibo", () => {
  const filas = filasRecibo(receipt, opts);

  it("encabeza con el nombre del negocio y el título del recibo", () => {
    expect(filas[0]).toMatchObject({ tipo: "centro", texto: "Manuela Desayuna", negrita: true });
    expect(filas[1]).toMatchObject({ tipo: "centro", texto: "Recibo" });
  });

  it("mete el número de pedido, la mesa y la fecha en la cabecera", () => {
    const cabecera = filas.find((f) => f.tipo === "centro" && /#2/.test(f.texto));
    expect(cabecera, "fila de cabecera").toBeTruthy();
    expect(cabecera && "texto" in cabecera ? cabecera.texto : "").toContain("Mesa 1");
    expect(cabecera && "texto" in cabecera ? cabecera.texto : "").toContain("23/7/2026");
  });

  it("pone cada línea con su precio y sus extras/notas como detalle", () => {
    const partidas = filas.filter((f) => f.tipo === "partida");
    // dos platos + la fila del total
    expect(partidas).toHaveLength(3);
    expect(partidas[0]).toMatchObject({ izq: "1× La Antioxidante Pro", der: "5.50 €" });

    const detalles = filas.filter((f) => f.tipo === "detalle");
    expect(detalles.map((d) => ("texto" in d ? d.texto : ""))).toEqual([
      "Pan sin gluten",
      "“Sin cebolla”",
    ]);
  });

  it("cierra con el total en negrita", () => {
    const ultimaPartida = [...filas].reverse().find((f) => f.tipo === "partida");
    expect(ultimaPartida).toMatchObject({ izq: "Total", der: "10.00 €", negrita: true });
  });
});
