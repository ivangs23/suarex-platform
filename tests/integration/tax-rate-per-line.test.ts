import { createPendingOrder } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * IVA POR LÍNEA. El caso de diario en un bar español: el menú tributa al 10 % y la botella que te
 * llevas al 21 %, en el mismo ticket. Con un tipo único por pedido, uno de los dos se factura mal
 * siempre.
 *
 * El tipo se resuelve en tres escalones -- producto, categoría, tenant -- y se CONGELA en la
 * línea: un pedido de ayer no puede cambiar de IVA porque hoy se edite la carta.
 */
let tenant: TenantFixture;
let venueId: string;
let tableId: string;
/** 11,00 € al 10 % (hereda del tenant). */
let menuId: string;
/** 12,10 € al 21 % (heredado de una categoría "Tienda"). */
let botellaId: string;
/** 2,50 € al 4 %, puesto en el propio producto para ejercer el escalón más concreto. */
let panId: string;

async function nuevaCategoria(slug: string, taxRate: number | null): Promise<string> {
  const { data, error } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `${slug}-${nonce()}`,
      name_i18n: { es: slug },
      destination: "cocina",
      tax_rate: taxRate,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function nuevoProducto(
  categoryId: string,
  precio: number,
  taxRate: number | null,
): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: categoryId,
      name_i18n: { es: `p-${nonce()}` },
      price: precio,
      tax_rate: taxRate,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  tenant = await createTenantFixture(`iva-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
  const { data: table } = await admin
    .from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: "1" })
    .select("id")
    .single();
  tableId = table?.id as string;

  const cocina = await nuevaCategoria("cocina", null);
  const tienda = await nuevaCategoria("tienda", 0.21);
  menuId = await nuevoProducto(cocina, 11, null);
  botellaId = await nuevoProducto(tienda, 12.1, null);
  panId = await nuevoProducto(cocina, 2.5, 0.04);
});

afterAll(async () => {
  if (tenant) await deleteTenantFixture(tenant);
});

async function lineasDe(orderId: string) {
  const { data, error } = await admin
    .from("order_items")
    .select("tax_rate, line_total")
    .eq("order_id", orderId);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    taxRate: Number(r.tax_rate),
    lineTotal: Number(r.line_total),
  }));
}

describe("IVA por línea (#pulido)", () => {
  it("un menú y una botella en el mismo ticket llevan tipos distintos", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [
        { productId: menuId, quantity: 1, extraIds: [], notes: null },
        { productId: botellaId, quantity: 1, extraIds: [], notes: null },
      ],
      taxRate: 0.1,
    });

    const lineas = await lineasDe(order.orderId);
    expect(lineas.map((l) => l.taxRate).sort()).toEqual([0.1, 0.21]);

    // 11,00 al 10 % -> base 10,00 + cuota 1,00. 12,10 al 21 % -> base 10,00 + cuota 2,10.
    const { data: pedido } = await admin
      .from("orders")
      .select("subtotal, tax_amount, total")
      .eq("id", order.orderId)
      .single();
    expect(Number(pedido?.total)).toBeCloseTo(23.1, 2);
    expect(Number(pedido?.subtotal)).toBeCloseTo(20, 2);
    expect(Number(pedido?.tax_amount)).toBeCloseTo(3.1, 2);
    // Y el invariante de siempre: base + cuota == total, sin céntimos perdidos.
    expect(Number(pedido?.subtotal) + Number(pedido?.tax_amount)).toBeCloseTo(
      Number(pedido?.total),
      2,
    );
  });

  it("el tipo del producto gana al de su categoría", async () => {
    // El pan está en la categoría de cocina (que hereda 10 %) pero lleva 4 % propio.
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId: panId, quantity: 1, extraIds: [], notes: null }],
      taxRate: 0.1,
    });
    expect((await lineasDe(order.orderId))[0]?.taxRate).toBe(0.04);
  });

  it("sin tipo en producto ni categoría, hereda el de la casa", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId: menuId, quantity: 1, extraIds: [], notes: null }],
      taxRate: 0.1,
    });
    expect((await lineasDe(order.orderId))[0]?.taxRate).toBe(0.1);
  });

  it("el tipo queda congelado: cambiar la carta después no toca pedidos ya emitidos", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId: menuId, quantity: 1, extraIds: [], notes: null }],
      taxRate: 0.1,
    });
    await admin.from("products").update({ tax_rate: 0.21 }).eq("id", menuId);
    try {
      expect((await lineasDe(order.orderId))[0]?.taxRate).toBe(0.1);
    } finally {
      await admin.from("products").update({ tax_rate: null }).eq("id", menuId);
    }
  });
});
