import { selectUnprintedOrders, type EnabledPrinterRow, type PaidOrderRow } from "@suarex/db";
import { describe, expect, it } from "vitest";

function order(overrides: Partial<PaidOrderRow>): PaidOrderRow {
  return {
    id: "o1",
    order_number: 1,
    created_at: "2026-01-01T00:00:00Z",
    printed_targets: {},
    venue_id: "v1",
    kitchen_status: "pending",
    bar_status: "na",
    tables: { label: "Mesa 1" },
    order_items: [
      { name_snapshot: { es: "Paella" }, quantity: 2, destination: "cocina", notes: null },
    ],
    ...overrides,
  };
}

const cocinaPrinter: EnabledPrinterRow = { id: "p-cocina", venue_id: "v1", destination: "cocina" };

describe("selectUnprintedOrders (pura)", () => {
  it("devuelve un pedido con impresora de destino aún no cubierta", () => {
    const result = selectUnprintedOrders([order({})], [cocinaPrinter]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "o1",
      orderNumber: 1,
      tableLabel: "Mesa 1",
      items: [{ name: "Paella", quantity: 2, destination: "cocina", notes: null }],
    });
  });

  it("excluye un pedido cuya impresora de destino ya está en printed_targets", () => {
    const covered = order({ printed_targets: { "p-cocina": "2026-01-01T00:01:00Z" } });
    expect(selectUnprintedOrders([covered], [cocinaPrinter])).toHaveLength(0);
  });

  it("excluye un pedido sin ninguna impresora de destino (estación sin impresora = trivialmente cubierta)", () => {
    // El pedido necesita cocina pero no hay impresora de cocina habilitada del mismo venue.
    expect(selectUnprintedOrders([order({})], [])).toHaveLength(0);
  });

  it("una impresora 'all' cubre cualquier estación usada", () => {
    const allPrinter: EnabledPrinterRow = { id: "p-all", venue_id: "v1", destination: "all" };
    const result = selectUnprintedOrders([order({})], [allPrinter]);
    expect(result).toHaveLength(1);
  });

  it("ignora impresoras de otro venue", () => {
    const otherVenue: EnabledPrinterRow = { id: "p-x", venue_id: "v2", destination: "cocina" };
    expect(selectUnprintedOrders([order({})], [otherVenue])).toHaveLength(0);
  });
});
