import type { OrderReceipt } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { strings } from "@/lib/i18n";
import { filasRecibo, nombreArchivoRecibo } from "./receipt-pdf";

const receipt: OrderReceipt = {
  orderNumber: 2,
  createdAt: "2026-07-23T23:37:53.147Z",
  tableLabel: "1",
  subtotalCents: 900,
  taxCents: 100,
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
    // dos platos + base imponible + IVA + total (el fixture lleva taxCents > 0)
    expect(partidas).toHaveLength(5);
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

describe("bloque fiscal del recibo", () => {
  const conFiscal = {
    ...opts,
    fiscal: {
      legalName: "Paco SL",
      cif: "B12345678",
      address: "Calle Falsa 1",
      phone: "600111222",
    },
  };

  it("pinta el emisor con los datos que el tenant tenga rellenos", () => {
    const texto = JSON.stringify(filasRecibo(receipt, conFiscal));
    expect(texto).toContain("Paco SL");
    expect(texto).toContain("B12345678");
    expect(texto).toContain("Calle Falsa 1");
    expect(texto).toContain("600111222");
  });

  it("no inventa líneas para los campos fiscales que falten", () => {
    // Un tenant a medio configurar no puede acabar con un recibo lleno de huecos o de
    // "undefined": se pinta lo que hay y se omite lo que no.
    const filas = filasRecibo(receipt, { ...opts, fiscal: { legalName: "Paco SL" } });
    const texto = JSON.stringify(filas);
    expect(texto).toContain("Paco SL");
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("CIF");
  });

  it("desglosa base imponible e IVA", () => {
    const texto = JSON.stringify(filasRecibo(receipt, conFiscal));
    expect(texto).toContain("Base imponible");
    expect(texto).toContain("IVA");
  });

  it("omite el desglose cuando el tenant no repercute IVA", () => {
    // Una línea de "IVA 0,00 €" no aporta nada y sí confunde.
    const sinIva = { ...receipt, subtotalCents: 1000, taxCents: 0, totalCents: 1000 };
    const texto = JSON.stringify(filasRecibo(sinIva, conFiscal));
    expect(texto).not.toContain("Base imponible");
  });

  it("el aviso de que no es factura se pinta SIEMPRE, con o sin datos fiscales", () => {
    // Doctrina: esto no es opcional por tenant. Un tenant sin CIF configurado no puede
    // acabar con un documento que parezca una factura. `opts` no trae `fiscal`.
    expect(JSON.stringify(filasRecibo(receipt, opts))).toContain("No válido como factura");
    expect(JSON.stringify(filasRecibo(receipt, conFiscal))).toContain("No válido como factura");
  });
});
