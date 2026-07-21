import { listActiveOrders, markStationDone } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let venueA: string;
let productA: string;

afterAll(async () => {
  for (const fixture of [tenantA, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

beforeAll(async () => {
  tenantA = await createTenantFixture(`staff-ord-a-${nonce()}`);
  tenantB = await createTenantFixture(`staff-ord-b-${nonce()}`);

  const seedA = await seedCatalog(tenantA.tenantId, "a");
  await seedCatalog(tenantB.tenantId, "b");
  venueA = seedA.venueId;
  productA = seedA.productId;
});

/** Inserta un pedido real (con líneas) para un tenant, con destino/estaciones a medida. */
async function insertOrder(
  tenantId: string,
  venueId: string,
  productId: string,
  options: {
    orderNumber: number;
    destination: "cocina" | "barra";
    kitchenStatus?: "pending" | "done" | "na";
    barStatus?: "pending" | "done" | "na";
    status?: string;
    tableId?: string | null;
  },
): Promise<string> {
  const kitchenStatus =
    options.kitchenStatus ?? (options.destination === "cocina" ? "pending" : "na");
  const barStatus = options.barStatus ?? (options.destination === "barra" ? "pending" : "na");

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      venue_id: venueId,
      table_id: options.tableId ?? null,
      order_number: options.orderNumber,
      status: options.status ?? "pending",
      kitchen_status: kitchenStatus,
      bar_status: barStatus,
    })
    .select("id")
    .single();
  if (orderError) throw orderError;

  const { error: itemError } = await admin.from("order_items").insert({
    tenant_id: tenantId,
    order_id: order.id,
    product_id: productId,
    name_snapshot: { es: `Item ${options.destination}` },
    unit_price: 9.5,
    quantity: 1,
    line_total: 9.5,
    destination: options.destination,
  });
  if (itemError) throw itemError;

  return order.id as string;
}

describe("listActiveOrders", () => {
  it("solo devuelve los pedidos activos del tenant pedido, nunca los de otro", async () => {
    const ownOrderId = await insertOrder(tenantA.tenantId, venueA, productA, {
      orderNumber: 101,
      destination: "barra",
    });
    // Pedido de OTRO tenant, con su propio venue/producto: si listActiveOrders(tenantA)
    // alguna vez lo devolviera, sería una fuga cross-tenant real, no un accidente de
    // datos incompletos (todas las FKs son válidas para tenantB). `seedCatalog` (ver
    // beforeAll) también deja su propio pedido `orderNumber: 1` sembrado para tenantB
    // -- usamos SU id, no uno nuevo, precisamente para que el control de fuga cubra
    // también esa fila, no solo la que este test inserta a mano.
    const { data: venueB } = await admin
      .from("venues")
      .select("id")
      .eq("tenant_id", tenantB.tenantId)
      .single();
    const { data: productB } = await admin
      .from("products")
      .select("id")
      .eq("tenant_id", tenantB.tenantId)
      .single();
    const foreignOrderId = await insertOrder(
      tenantB.tenantId,
      venueB?.id as string,
      productB?.id as string,
      { orderNumber: 999, destination: "cocina" },
    );

    const orders = await listActiveOrders(tenantA.tenantId);

    // Control positivo: la propia fila SÍ aparece (si no, "ninguna fuga" sería un falso
    // positivo trivial de una policy/filtro deny-all).
    expect(orders.some((o) => o.id === ownOrderId)).toBe(true);
    // Aislamiento: ninguna fila de tenantB, ni la sembrada por seedCatalog ni la de
    // arriba, aparece jamás en la respuesta para tenantA.
    const leaked = orders.filter((o) => o.id === foreignOrderId);
    expect(leaked, "listActiveOrders devolvió un pedido de otro tenant").toHaveLength(0);
  });

  it("excluye pedidos servidos y cancelados", async () => {
    const before = (await listActiveOrders(tenantA.tenantId)).length;

    await insertOrder(tenantA.tenantId, venueA, productA, {
      orderNumber: 102,
      destination: "barra",
      status: "served",
      kitchenStatus: "na",
      barStatus: "done",
    });
    await insertOrder(tenantA.tenantId, venueA, productA, {
      orderNumber: 103,
      destination: "barra",
      status: "cancelled",
    });

    const after = await listActiveOrders(tenantA.tenantId);
    expect(after.length).toBe(before);
  });

  it("un pedido solo de bebidas no aparece con estación de cocina pendiente", async () => {
    const orderId = await insertOrder(tenantA.tenantId, venueA, productA, {
      orderNumber: 104,
      destination: "barra",
    });

    const orders = await listActiveOrders(tenantA.tenantId);
    const order = orders.find((o) => o.id === orderId);

    expect(order?.kitchenStatus).toBe("na");
    expect(order?.barStatus).toBe("pending");
    expect(order?.items.every((item) => item.destination === "barra")).toBe(true);
  });
});

describe("markStationDone", () => {
  it("marca la estación pedida y dos veces seguidas no hace nada la segunda vez", async () => {
    const orderId = await insertOrder(tenantA.tenantId, venueA, productA, {
      orderNumber: 201,
      destination: "barra",
    });

    await markStationDone(tenantA.tenantId, orderId, "barra");

    const { data: afterFirst } = await admin
      .from("orders")
      .select("bar_status, status")
      .eq("id", orderId)
      .single();
    expect(afterFirst?.bar_status).toBe("done");
    // Única estación (barra) resuelta, cocina era "na" -> el pedido pasa a servido.
    expect(afterFirst?.status).toBe("served");

    // Segunda llamada: la estación ya no está "pending", así que no encuentra fila que
    // actualizar y no lanza ni cambia nada.
    await expect(markStationDone(tenantA.tenantId, orderId, "barra")).resolves.toBeUndefined();

    const { data: afterSecond } = await admin
      .from("orders")
      .select("bar_status, status")
      .eq("id", orderId)
      .single();
    expect(afterSecond?.bar_status).toBe("done");
    expect(afterSecond?.status).toBe("served");
  });

  it("el pedido pasa a servido solo cuando AMBAS estaciones quedan fuera de pending", async () => {
    const { data: order, error } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantA.tenantId,
        venue_id: venueA,
        order_number: 202,
        status: "pending",
        kitchen_status: "pending",
        bar_status: "pending",
      })
      .select("id")
      .single();
    if (error) throw error;

    await markStationDone(tenantA.tenantId, order.id, "cocina");

    const { data: afterKitchen } = await admin
      .from("orders")
      .select("kitchen_status, bar_status, status")
      .eq("id", order.id)
      .single();
    expect(afterKitchen?.kitchen_status).toBe("done");
    // Barra sigue pendiente: el pedido NO pasa a servido todavía.
    expect(afterKitchen?.status).toBe("pending");

    await markStationDone(tenantA.tenantId, order.id, "barra");

    const { data: afterBar } = await admin
      .from("orders")
      .select("bar_status, status")
      .eq("id", order.id)
      .single();
    expect(afterBar?.bar_status).toBe("done");
    expect(afterBar?.status).toBe("served");
  });

  it("marcar una estación 'na' no hace nada (no la convierte en 'done')", async () => {
    const orderId = await insertOrder(tenantA.tenantId, venueA, productA, {
      orderNumber: 203,
      destination: "barra", // kitchen_status queda "na"
    });

    await markStationDone(tenantA.tenantId, orderId, "cocina");

    const { data } = await admin
      .from("orders")
      .select("kitchen_status, status")
      .eq("id", orderId)
      .single();
    expect(data?.kitchen_status).toBe("na");
    expect(data?.status).toBe("pending");
  });

  it("SECURITY: un tenantId ajeno no puede mutar el pedido de otro tenant", async () => {
    const orderId = await insertOrder(tenantA.tenantId, venueA, productA, {
      orderNumber: 204,
      destination: "barra",
    });

    // tenantB intenta marcar hecho un pedido que es de tenantA -- `tenantScoped` filtra
    // por `tenant_id = tenantB.tenantId`, así que el `.eq("id", orderId)` no encuentra
    // ninguna fila: la llamada no lanza y no muta nada.
    await expect(markStationDone(tenantB.tenantId, orderId, "barra")).resolves.toBeUndefined();

    const { data } = await admin
      .from("orders")
      .select("bar_status, status")
      .eq("id", orderId)
      .single();
    expect(data?.bar_status, "un tenant ajeno pudo marcar la estación de otro").toBe("pending");
    expect(data?.status).toBe("pending");
  });
});
