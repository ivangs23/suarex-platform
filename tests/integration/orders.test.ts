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

  it("rechaza un taxRate no finito", async () => {
    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
        taxRate: Number.NaN,
      }),
    ).rejects.toThrow(/taxRate/);

    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
        taxRate: Number.POSITIVE_INFINITY,
      }),
    ).rejects.toThrow(/taxRate/);
  });

  it("rechaza un taxRate fuera de rango [0, 1)", async () => {
    // Negativo: 1 + taxRate se acercaría o cruzaría cero (base infinita o de signo cambiado).
    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
        taxRate: -1,
      }),
    ).rejects.toThrow(/taxRate/);

    // >= 1: ninguna jurisdicción real aplica IVA >= 100 %; también atrapa el error
    // clásico de pasar el tipo como porcentaje entero (21) en vez de fracción (0.21).
    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
        taxRate: 21,
      }),
    ).rejects.toThrow(/taxRate/);
  });

  it("acepta un taxRate normal dentro de rango", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
      taxRate: 0.21,
    });
    expect(order.totalCents).toBe(1800);
  });
});

describe("createPendingOrder — extras", () => {
  let extraId: string;

  beforeAll(async () => {
    const { data: extra } = await admin
      .from("product_extras")
      .insert({
        tenant_id: tenant.tenantId,
        product_id: productId,
        name_i18n: { es: "Extra queso" },
        price: 2.5,
      })
      .select("id")
      .single();
    extraId = extra?.id as string;
  });

  it("cobra el precio del producto más el de la extra, leídos de la base, e ignora cualquier precio enviado por el cliente", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      // El tipo CartLineInput no tiene ningún campo de precio: ni la extra ni el
      // producto pueden llevar uno adjunto desde el "cliente" (aquí, este test).
      lines: [{ productId, quantity: 2, extraIds: [extraId], notes: null }],
      taxRate: 0.1,
    });

    // 18,00 € producto + 2,50 € extra = 20,50 € por unidad x 2 = 41,00 €.
    expect(order.totalCents).toBe(4100);

    const { data: item } = await admin
      .from("order_items")
      .select("id, unit_price, quantity, line_total")
      .eq("order_id", order.orderId)
      .single();
    expect(Number(item?.unit_price)).toBe(18);
    expect(Number(item?.line_total)).toBe(41);

    const { data: extraRows } = await admin
      .from("order_item_extras")
      .select("order_item_id, extra_id, name_snapshot, price")
      .eq("order_item_id", item?.id);
    expect(extraRows).toHaveLength(1);
    expect(extraRows?.[0]?.extra_id).toBe(extraId);
    expect(Number(extraRows?.[0]?.price)).toBe(2.5);
    expect(extraRows?.[0]?.name_snapshot).toEqual({ es: "Extra queso" });
  });

  it("rechaza un extra de otro tenant, ignorando su id aunque exista de verdad", async () => {
    const otro = await createTenantFixture(`ord-extra-otro-${nonce()}`);
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
        price: 5,
      })
      .select("id")
      .single();
    const { data: foreignExtra } = await admin
      .from("product_extras")
      .insert({
        tenant_id: otro.tenantId,
        product_id: prod?.id,
        name_i18n: { es: "Extra ajena" },
        price: 0.01,
      })
      .select("id")
      .single();

    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [{ productId, quantity: 1, extraIds: [foreignExtra?.id as string], notes: null }],
        taxRate: 0.1,
      }),
    ).rejects.toThrow(/no disponible/i);
  });

  it("rechaza un extra que existe pero pertenece a otro producto del MISMO tenant", async () => {
    const { data: category2 } = await admin
      .from("categories")
      .insert({ tenant_id: tenant.tenantId, slug: `c2-${nonce()}`, name_i18n: { es: "Otra" } })
      .select("id")
      .single();
    const { data: otherProduct } = await admin
      .from("products")
      .insert({
        tenant_id: tenant.tenantId,
        category_id: category2?.id,
        name_i18n: { es: "Otro producto" },
        price: 3,
      })
      .select("id")
      .single();
    const { data: otherExtra } = await admin
      .from("product_extras")
      .insert({
        tenant_id: tenant.tenantId,
        product_id: otherProduct?.id,
        name_i18n: { es: "Extra de otro producto" },
        price: 1,
      })
      .select("id")
      .single();

    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        // productId es el producto ORIGINAL de este describe; otherExtra pertenece
        // a otherProduct, no a productId.
        lines: [{ productId, quantity: 1, extraIds: [otherExtra?.id as string], notes: null }],
        taxRate: 0.1,
      }),
    ).rejects.toThrow(/no disponible/i);
  });

  it("un id de extra duplicado en la misma línea se cobra una sola vez", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId, quantity: 1, extraIds: [extraId, extraId], notes: null }],
      taxRate: 0.1,
    });

    // 18,00 € + 2,50 € = 20,50 €, NO 23,00 € (que sería cobrar la extra dos veces).
    expect(order.totalCents).toBe(2050);
  });

  it("rechaza un id de extra inexistente", async () => {
    await expect(
      createPendingOrder({
        tenantId: tenant.tenantId,
        venueId,
        tableId,
        lines: [
          {
            productId,
            quantity: 1,
            extraIds: ["00000000-0000-0000-0000-000000000000"],
            notes: null,
          },
        ],
        taxRate: 0.1,
      }),
    ).rejects.toThrow(/no disponible/i);
  });

  it("congela el precio de la extra: subirlo DESPUÉS en la base no reescribe un pedido ya creado", async () => {
    // Extra propia de este test (no la compartida `extraId` de arriba) para no acoplar
    // el orden de ejecución de los demás tests de este describe a su precio.
    const { data: ownExtra } = await admin
      .from("product_extras")
      .insert({
        tenant_id: tenant.tenantId,
        product_id: productId,
        name_i18n: { es: "Extra congelable" },
        price: 2.5,
      })
      .select("id")
      .single();
    const ownExtraId = ownExtra?.id as string;

    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId, quantity: 1, extraIds: [ownExtraId], notes: null }],
      taxRate: 0.1,
    });
    expect(order.totalCents).toBe(2050); // 18,00 € + 2,50 €

    // El precio de la extra sube en la base DESPUÉS de que el pedido ya existe.
    const { error: updateError } = await admin
      .from("product_extras")
      .update({ price: 99, name_i18n: { es: "Extra renombrada" } })
      .eq("id", ownExtraId);
    if (updateError) throw updateError;

    const { data: item } = await admin
      .from("order_items")
      .select("id")
      .eq("order_id", order.orderId)
      .single();
    const { data: extraRow } = await admin
      .from("order_item_extras")
      .select("price, name_snapshot")
      .eq("order_item_id", item?.id)
      .single();

    // El pedido ya creado sigue mostrando el precio Y el nombre de cuando se hizo, no
    // los nuevos valores que la extra tiene ahora en product_extras.
    expect(Number(extraRow?.price)).toBe(2.5);
    expect(extraRow?.name_snapshot).toEqual({ es: "Extra congelable" });
  });
});

describe("markOrderPaid", () => {
  it("marca como pagado un pedido pending", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId,
      tableId,
      lines: [{ productId, quantity: 1, extraIds: [], notes: null }],
      taxRate: 0.1,
    });

    const pi = `pi_test_${nonce()}`;
    await admin.from("orders").update({ stripe_payment_intent_id: pi }).eq("id", order.orderId);

    const outcome = await markOrderPaid(pi);
    expect(outcome).toBe("marked");

    const { data } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", order.orderId)
      .single();
    expect(data?.status).toBe("paid");
    expect(data?.paid_at).not.toBeNull();
  });

  it("es idempotente: la segunda llamada da already-paid y paid_at no se mueve", async () => {
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
    expect(first).toBe("marked");

    const { data: afterFirst } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", order.orderId)
      .single();

    const second = await markOrderPaid(pi);
    expect(second).toBe("already-paid");

    const { data: afterSecond } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", order.orderId)
      .single();

    expect(afterSecond?.status).toBe("paid");
    expect(afterSecond?.status).toBe(afterFirst?.status);
    expect(afterSecond?.paid_at).toBe(afterFirst?.paid_at);
  });

  it("devuelve order-not-found cuando ningún pedido tiene ese payment intent", async () => {
    const outcome = await markOrderPaid(`pi_test_inexistente_${nonce()}`);
    expect(outcome).toBe("order-not-found");
  });
});
