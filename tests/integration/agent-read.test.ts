import { unprintedPaidOrdersForDevice } from "@suarex/agent";
import {
  type EnabledPrinterRow,
  type PaidOrderRow,
  selectUnprintedOrders,
  unprintedPaidOrders,
} from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  signInAs,
  type TenantFixture,
} from "./helpers/tenants.js";

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

// --- helpers de siembra (un venue con un pedido pagado de cocina, sin imprimir) ---
async function seedPaidKitchenOrder(tenant: TenantFixture): Promise<string> {
  // is_default: false -- este helper puede llamarse más de una vez para el mismo tenant
  // (los dos `it` de más abajo siembran ambos en tenantA) y `venues` tiene un índice único
  // parcial `(tenant_id) where is_default` (20260721000001_core_tenancy.sql); un segundo
  // venue is_default:true del mismo tenant lo violaría. is_default no lo lee ninguna
  // lógica de selectUnprintedOrders/RLS relevante aquí.
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: false })
    .select("id")
    .single();
  const venueId = venue?.id as string;
  const { data: cat } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `k-${nonce()}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    })
    .select("id")
    .single();
  const { data: prod } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: cat?.id,
      name_i18n: { es: "Paella" },
      price: 12,
    })
    .select("id")
    .single();
  const { data: table } = await admin
    .from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: `mesa-${nonce()}` })
    .select("id")
    .single();
  await admin.from("printers").insert({
    tenant_id: tenant.tenantId,
    venue_id: venueId,
    name: "Cocina",
    connection: { type: "network", host: "127.0.0.1", port: 9100 },
    destination: "cocina",
    enabled: true,
  });
  const { createPendingOrder } = await import("@suarex/db");
  const order = await createPendingOrder({
    tenantId: tenant.tenantId,
    venueId,
    tableId: table?.id as string,
    lines: [{ productId: prod?.id as string, quantity: 1, extraIds: [], notes: null }],
    taxRate: 0.1,
  });
  await admin
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.orderId);
  return order.orderId;
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;
const deviceUserIds: string[] = [];

beforeAll(async () => {
  tenantA = await createTenantFixture(`agr-a-${nonce()}`);
  tenantB = await createTenantFixture(`agr-b-${nonce()}`);
});
afterAll(async () => {
  for (const id of deviceUserIds) await deleteMembershipFixtureUser(id);
  if (tenantA) await deleteTenantFixture(tenantA);
  if (tenantB) await deleteTenantFixture(tenantB);
});

describe("unprintedPaidOrdersForDevice (JWT del device)", () => {
  it("un device del tenant A ve, con SU JWT, exactamente lo que ve la ruta service-role de A", async () => {
    const orderId = await seedPaidKitchenOrder(tenantA);
    // Sesión de dispositivo del tenant A (rol device, JWT con tenant_role=device).
    const deviceClient = await signInAs(tenantA.tenantId, "device");
    deviceUserIds.push(deviceClient.userId);

    const viaDevice = await unprintedPaidOrdersForDevice(deviceClient);
    const viaService = await unprintedPaidOrders(tenantA.tenantId);
    expect(viaDevice.map((o) => o.id).sort()).toEqual(viaService.map((o) => o.id).sort());
    expect(viaDevice.some((o) => o.id === orderId)).toBe(true);
  });

  it("un device del tenant B NO ve los pedidos de A (aislamiento por RLS)", async () => {
    const orderId = await seedPaidKitchenOrder(tenantA);
    const deviceB = await signInAs(tenantB.tenantId, "device");
    deviceUserIds.push(deviceB.userId);
    const viaDeviceB = await unprintedPaidOrdersForDevice(deviceB);
    expect(viaDeviceB.some((o) => o.id === orderId)).toBe(false);
  });
});
