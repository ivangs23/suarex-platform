import { createPendingOrder, findTableByToken, markOrderPaid } from "@suarex/db";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

let tenant: TenantFixture;
let venueId: string;
let tableToken: string;
let tableId: string;
let productId: string;

beforeAll(async () => {
  tenant = await createTenantFixture(`ord-${nonce()}`);

  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;

  const { data: category } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `c-${nonce()}`,
      name_i18n: { es: "Vinos" },
      destination: "barra",
    })
    .select("id")
    .single();

  const { data: product } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: category?.id,
      name_i18n: { es: "Ribera" },
      price: 18.0,
    })
    .select("id")
    .single();
  productId = product?.id as string;

  const { data: table } = await admin
    .from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: "1" })
    .select("id, token")
    .single();
  tableId = table?.id as string;
  tableToken = table?.token as string;
});

describe("findTableByToken", () => {
  it("resuelve tenant y local desde el token", async () => {
    const row = await findTableByToken(tableToken);
    expect(row?.tenantId).toBe(tenant.tenantId);
    expect(row?.venueId).toBe(venueId);
  });

  it("devuelve null para un token inexistente", async () => {
    expect(await findTableByToken("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("createPendingOrder", () => {
  it("ignora cualquier precio que venga del cliente y usa el de la base de datos", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId, quantity: 2, extraIds: [], notes: null }],
      taxRate: 0.1,
    });

    // 18,00 € x 2 = 36,00 €. Nada de lo que mande el navegador puede alterarlo.
    expect(order.totalCents).toBe(3600);

    const { data } = await admin
      .from("orders")
      .select("status, total, subtotal, tax_amount, order_number, bar_status, kitchen_status")
      .eq("id", order.orderId)
      .single();

    expect(data?.status).toBe("pending");
    expect(Number(data?.total)).toBe(36);
    expect(Number(data?.subtotal) + Number(data?.tax_amount)).toBe(36);
    expect(data?.order_number).toBeGreaterThan(0);
    // El producto es de una categoría de barra, así que cocina no tiene nada que hacer.
    expect(data?.bar_status).toBe("pending");
    expect(data?.kitchen_status).toBe("na");
  });

  it("rechaza un producto de otro tenant", async () => {
    const otro = await createTenantFixture(`ord-otro-${nonce()}`);
    const { data: cat } = await admin
      .from("categories")
      .insert({ tenant_id: otro.tenantId, slug: `c-${nonce()}`, name_i18n: { es: "X" } })
      .select("id")
      .single();
    const { data: prod } = await admin
      .from("products")
      .insert({
        tenant_id: otro.tenantId,
        category_id: cat?.id,
        name_i18n: { es: "Ajeno" },
        price: 1,
      })
      .select("id")
      .single();

    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId: prod?.id as string, quantity: 1, extraIds: [], notes: null }],
        taxRate: 0.1,
      }),
    ).rejects.toThrow(/no disponible/i);
  });

  it("rechaza una cantidad no positiva", async () => {
    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId, quantity: 0, extraIds: [], notes: null }],
        taxRate: 0.1,
      }),
    ).rejects.toThrow();
  });
});

describe("markOrderPaid", () => {
  it("es idempotente", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
      taxRate: 0.1,
    });

    const pi = `pi_test_${nonce()}`;
    await admin.from("orders").update({ stripe_payment_intent_id: pi }).eq("id", order.orderId);

    const first = await markOrderPaid(pi);
    expect(first.alreadyPaid).toBe(false);

    const { data: afterFirst } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", order.orderId)
      .single();

    const second = await markOrderPaid(pi);
    expect(second.alreadyPaid).toBe(true);

    const { data: afterSecond } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", order.orderId)
      .single();

    expect(afterSecond?.status).toBe("paid");
    expect(afterSecond?.paid_at).toBe(afterFirst?.paid_at);
  });
});
