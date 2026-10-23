import {
  MAX_CANTIDAD_LINEA,
  MAX_EXTRAS_LINEA,
  MAX_LINEAS_PEDIDO,
  MAX_NOTAS_LINEA,
} from "@suarex/domain";
import { describe, expect, it } from "vitest";
import { kioskoOrderSchema, orderLinesSchema, pairDeviceSchema, parseJsonBody } from "./api-input";

const PRODUCTO = "4a0e9c1e-7a52-4d47-9c3b-2b5f4b8f1a10";
const EXTRA = "9b1f2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const linea = (cambios: Record<string, unknown> = {}) => ({
  productId: PRODUCTO,
  quantity: 1,
  extraIds: [],
  notes: null,
  ...cambios,
});

describe("orderLinesSchema", () => {
  it("acepta un pedido normal", () => {
    const r = orderLinesSchema.safeParse({ lines: [linea({ quantity: 2, extraIds: [EXTRA] })] });
    expect(r.success).toBe(true);
  });

  it("acepta los ids sembrados que no cumplen la variante RFC (1111…)", () => {
    const sembrado = "11111111-1111-1111-1111-111111111111";
    expect(orderLinesSchema.safeParse({ lines: [linea({ productId: sembrado })] }).success).toBe(
      true,
    );
  });

  it("una nota ausente queda como null y faltan extras = ninguna", () => {
    const r = orderLinesSchema.parse({ lines: [{ productId: PRODUCTO, quantity: 1 }] });
    expect(r.lines[0]).toEqual({ productId: PRODUCTO, quantity: 1, extraIds: [], notes: null });
  });

  it("acepta los límites exactos", () => {
    const r = orderLinesSchema.safeParse({
      lines: Array.from({ length: MAX_LINEAS_PEDIDO }, () =>
        linea({
          quantity: MAX_CANTIDAD_LINEA,
          extraIds: Array.from({ length: MAX_EXTRAS_LINEA }, () => EXTRA),
          notes: "x".repeat(MAX_NOTAS_LINEA),
        }),
      ),
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["sin cuerpo de líneas", {}],
    ["líneas vacías", { lines: [] }],
    ["demasiadas líneas", { lines: Array.from({ length: MAX_LINEAS_PEDIDO + 1 }, () => linea()) }],
    ["productId que no es uuid", { lines: [linea({ productId: "1; drop table orders" })] }],
    ["cantidad 0", { lines: [linea({ quantity: 0 })] }],
    ["cantidad por encima del máximo", { lines: [linea({ quantity: MAX_CANTIDAD_LINEA + 1 })] }],
    ["cantidad con decimales", { lines: [linea({ quantity: 1.5 })] }],
    ["cantidad como texto", { lines: [linea({ quantity: "2" })] }],
    [
      "demasiadas extras",
      { lines: [linea({ extraIds: Array.from({ length: MAX_EXTRAS_LINEA + 1 }, () => EXTRA) })] },
    ],
    ["extra que no es uuid", { lines: [linea({ extraIds: ["x"] })] }],
    ["nota demasiado larga", { lines: [linea({ notes: "x".repeat(MAX_NOTAS_LINEA + 1) })] }],
    ["nota que no es texto", { lines: [linea({ notes: 42 })] }],
  ])("rechaza: %s", (_, cuerpo) => {
    expect(orderLinesSchema.safeParse(cuerpo).success).toBe(false);
  });
});

describe("kioskoOrderSchema", () => {
  it("acepta un pedido del totem, con o sin mesa", () => {
    expect(kioskoOrderSchema.safeParse({ token: PRODUCTO, lines: [linea()] }).success).toBe(true);
    expect(
      kioskoOrderSchema.safeParse({ token: PRODUCTO, tableLabel: "7", lines: [linea()] }).success,
    ).toBe(true);
  });

  it("rechaza un token que no es uuid o que falta", () => {
    expect(kioskoOrderSchema.safeParse({ token: "abc", lines: [linea()] }).success).toBe(false);
    expect(kioskoOrderSchema.safeParse({ lines: [linea()] }).success).toBe(false);
  });
});

describe("pairDeviceSchema", () => {
  it("acepta un código y rechaza lo demás", () => {
    expect(pairDeviceSchema.safeParse({ pairingCode: "ABC123" }).success).toBe(true);
    expect(pairDeviceSchema.safeParse({ pairingCode: "" }).success).toBe(false);
    expect(pairDeviceSchema.safeParse({ pairingCode: 123 }).success).toBe(false);
    expect(pairDeviceSchema.safeParse(null).success).toBe(false);
  });
});

describe("parseJsonBody", () => {
  const peticion = (cuerpo: string) =>
    new Request("http://localhost/api", { method: "POST", body: cuerpo });

  it("devuelve los datos validados", async () => {
    const r = await parseJsonBody(
      peticion(JSON.stringify({ pairingCode: "ABC" })),
      pairDeviceSchema,
    );
    expect(r).toEqual({ ok: true, data: { pairingCode: "ABC" } });
  });

  it("un JSON roto y uno con otra forma dan el mismo 400 genérico", async () => {
    for (const cuerpo of ["{no es json", JSON.stringify({ otra: "cosa" })]) {
      const r = await parseJsonBody(peticion(cuerpo), pairDeviceSchema);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.response.status).toBe(400);
      expect(await r.response.json()).toEqual({ error: "Petición inválida" });
    }
  });

  it("usa la respuesta que le pasen si falla", async () => {
    const r = await parseJsonBody(
      peticion("{"),
      pairDeviceSchema,
      () => new Response(null, { status: 404 }),
    );
    expect(r.ok ? 200 : r.response.status).toBe(404);
  });
});
