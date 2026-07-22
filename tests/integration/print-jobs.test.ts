import { createPendingOrder, reservePrinted, unprintedPaidOrders } from "@suarex/db";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

/**
 * Local con dos impresoras habilitadas, una por estación (cocina/barra), y los
 * productos/categorías necesarios para poder pedir de cada estación. Devuelto como
 * un solo objeto porque cada test de este fichero necesita las cuatro piezas (venue,
 * los dos ids de producto y los dos ids de impresora) para montar sus propios pedidos.
 */
type Venue = {
  venueId: string;
  tableId: string;
  kitchenProductId: string;
  barProductId: string;
  kitchenPrinterId: string;
  barPrinterId: string;
};

async function seedVenueWithPrinters(tenant: TenantFixture, label: string): Promise<Venue> {
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${label}`, name: "V", is_default: true })
    .select("id")
    .single();
  const venueId = venue?.id as string;

  const { data: kitchenCategory } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `k-${label}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    })
    .select("id")
    .single();
  const { data: barCategory } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `b-${label}`,
      name_i18n: { es: "Barra" },
      destination: "barra",
    })
    .select("id")
    .single();

  const { data: kitchenProduct } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: kitchenCategory?.id,
      name_i18n: { es: "Paella" },
      price: 12,
    })
    .select("id")
    .single();
  const { data: barProduct } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: barCategory?.id,
      name_i18n: { es: "Cerveza" },
      price: 3,
    })
    .select("id")
    .single();

  const { data: table } = await admin
    .from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: `mesa-${label}` })
    .select("id")
    .single();

  const { data: kitchenPrinter } = await admin
    .from("printers")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: `Cocina ${label}`,
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
      destination: "cocina",
      enabled: true,
    })
    .select("id")
    .single();
  const { data: barPrinter } = await admin
    .from("printers")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: `Barra ${label}`,
      connection: { type: "network", host: "127.0.0.1", port: 9101 },
      destination: "barra",
      enabled: true,
    })
    .select("id")
    .single();

  return {
    venueId,
    tableId: table?.id as string,
    kitchenProductId: kitchenProduct?.id as string,
    barProductId: barProduct?.id as string,
    kitchenPrinterId: kitchenPrinter?.id as string,
    barPrinterId: barPrinter?.id as string,
  };
}

/** Pedido con una línea de cocina y una de barra (paga las dos impresoras), marcado `paid`. */
async function createPaidMixedOrder(tenant: TenantFixture, venue: Venue): Promise<string> {
  const order = await createPendingOrder({
    tenantId: tenant.tenantId,
    venueId: venue.venueId,
    tableId: venue.tableId,
    lines: [
      { productId: venue.kitchenProductId, quantity: 1, extraIds: [], notes: null },
      { productId: venue.barProductId, quantity: 1, extraIds: [], notes: null },
    ],
    taxRate: 0.1,
  });
  const { error } = await admin
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.orderId);
  if (error) throw error;
  return order.orderId;
}

/** Pedido SOLO de barra (bebidas), marcado `paid`: cocina no tiene nada que atender. */
async function createPaidDrinksOnlyOrder(tenant: TenantFixture, venue: Venue): Promise<string> {
  const order = await createPendingOrder({
    tenantId: tenant.tenantId,
    venueId: venue.venueId,
    tableId: venue.tableId,
    lines: [{ productId: venue.barProductId, quantity: 1, extraIds: [], notes: null }],
    taxRate: 0.1,
  });
  const { error } = await admin
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.orderId);
  if (error) throw error;
  return order.orderId;
}

let tenant: TenantFixture;
let venue: Venue;

beforeAll(async () => {
  tenant = await createTenantFixture(`prn-${nonce()}`);
  venue = await seedVenueWithPrinters(tenant, nonce());
});

describe("unprintedPaidOrders", () => {
  it("un pedido pagado sin printed_targets aparece (control positivo, antes de reservar nada)", async () => {
    const orderId = await createPaidMixedOrder(tenant, venue);

    const pending = await unprintedPaidOrders(tenant.tenantId);
    const found = pending.find((o) => o.id === orderId);
    expect(found).toBeDefined();
    expect(found?.printedTargets).toEqual({});
    expect(found?.items).toHaveLength(2);
    expect(found?.items.map((i) => i.destination).sort()).toEqual(["barra", "cocina"]);
  });

  it("tras reservar TODAS sus impresoras de destino, deja de aparecer y printed_at queda puesto", async () => {
    const orderId = await createPaidMixedOrder(tenant, venue);
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(true); // control positivo

    await reservePrinted(
      tenant.tenantId,
      orderId,
      venue.kitchenPrinterId,
      new Date().toISOString(),
    );
    await reservePrinted(tenant.tenantId, orderId, venue.barPrinterId, new Date().toISOString());

    const pending = await unprintedPaidOrders(tenant.tenantId);
    expect(pending.some((o) => o.id === orderId)).toBe(false);

    const { data } = await admin
      .from("orders")
      .select("printed_at, printed_targets")
      .eq("id", orderId)
      .single();
    expect(data?.printed_at).not.toBeNull();
    expect(Object.keys(data?.printed_targets ?? {}).sort()).toEqual(
      [venue.barPrinterId, venue.kitchenPrinterId].sort(),
    );
  });

  it("reservar UNA sola impresora no pone printed_at si quedan otras pendientes (fallo de barra no marca cocina impresa)", async () => {
    const orderId = await createPaidMixedOrder(tenant, venue);
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(true); // control positivo

    const at = new Date().toISOString();
    await reservePrinted(tenant.tenantId, orderId, venue.kitchenPrinterId, at);

    const { data } = await admin
      .from("orders")
      .select("printed_at, printed_targets")
      .eq("id", orderId)
      .single();
    expect(data?.printed_at).toBeNull();
    expect(data?.printed_targets).toEqual({ [venue.kitchenPrinterId]: at });

    // Sigue pendiente (barra no imprimió) y sigue apareciendo.
    const pending = await unprintedPaidOrders(tenant.tenantId);
    const found = pending.find((o) => o.id === orderId);
    expect(found).toBeDefined();
    expect(found?.printedTargets).toEqual({ [venue.kitchenPrinterId]: at });
  });

  it("un pedido solo de barra (bebidas) queda completo con SOLO la impresora de barra", async () => {
    const orderId = await createPaidDrinksOnlyOrder(tenant, venue);
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(true); // control positivo

    await reservePrinted(tenant.tenantId, orderId, venue.barPrinterId, new Date().toISOString());

    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(false);
    const { data } = await admin.from("orders").select("printed_at").eq("id", orderId).single();
    expect(data?.printed_at).not.toBeNull();
  });

  it("aísla por tenant: un pedido de otro tenant nunca aparece en unprintedPaidOrders del primero", async () => {
    const orderId = await createPaidMixedOrder(tenant, venue);

    const otherTenant = await createTenantFixture(`prn-otro-${nonce()}`);
    const otherVenue = await seedVenueWithPrinters(otherTenant, nonce());
    const otherOrderId = await createPaidMixedOrder(otherTenant, otherVenue);

    const pending = await unprintedPaidOrders(tenant.tenantId);
    // Control positivo: el propio pedido SÍ aparece.
    expect(pending.some((o) => o.id === orderId)).toBe(true);
    // El pedido ajeno nunca aparece, aunque también esté pagado y sin imprimir.
    expect(pending.some((o) => o.id === otherOrderId)).toBe(false);
  });
});

describe("reservePrinted — idempotencia", () => {
  it("llamar dos veces con la misma impresora no duplica y conserva el primer timestamp", async () => {
    const orderId = await createPaidMixedOrder(tenant, venue);

    const firstAt = new Date().toISOString();
    await reservePrinted(tenant.tenantId, orderId, venue.kitchenPrinterId, firstAt);

    const secondAt = new Date(Date.now() + 5_000).toISOString();
    await reservePrinted(tenant.tenantId, orderId, venue.kitchenPrinterId, secondAt);

    const { data } = await admin
      .from("orders")
      .select("printed_targets")
      .eq("id", orderId)
      .single();

    // Ni duplicado (una sola clave para esta impresora) ni pisado (se conserva firstAt).
    expect(Object.keys(data?.printed_targets ?? {})).toEqual([venue.kitchenPrinterId]);
    expect(data?.printed_targets?.[venue.kitchenPrinterId]).toBe(firstAt);
  });
});

describe("reservePrinted — concurrencia", () => {
  it("dos reservas simultáneas de impresoras distintas del mismo pedido no se pisan: ambas sobreviven", async () => {
    const orderId = await createPaidMixedOrder(tenant, venue);

    const atKitchen = new Date().toISOString();
    const atBar = new Date().toISOString();

    // Disparadas con Promise.all, SIN await intermedio, para que de verdad se solapen.
    // Un merge lectura-modificación-escritura ingenuo perdería una de las dos entradas
    // (la que lee `printed_targets` antes de que la otra lo escriba, y luego sobreescribe
    // con solo la suya). Contra ese código, este test FALLARÍA: solo una de las dos
    // claves sobreviviría. Contra el merge jsonb atómico (una sola sentencia UPDATE, con
    // el lock de fila serializando las dos llamadas) PASA: las dos claves sobreviven.
    await Promise.all([
      reservePrinted(tenant.tenantId, orderId, venue.kitchenPrinterId, atKitchen),
      reservePrinted(tenant.tenantId, orderId, venue.barPrinterId, atBar),
    ]);

    const { data } = await admin
      .from("orders")
      .select("printed_at, printed_targets")
      .eq("id", orderId)
      .single();

    expect(Object.keys(data?.printed_targets ?? {}).sort()).toEqual(
      [venue.barPrinterId, venue.kitchenPrinterId].sort(),
    );
    expect(data?.printed_targets?.[venue.kitchenPrinterId]).toBe(atKitchen);
    expect(data?.printed_targets?.[venue.barPrinterId]).toBe(atBar);
    // Ambas impresoras de destino quedaron cubiertas, así que printed_at también se fija.
    expect(data?.printed_at).not.toBeNull();
  });
});
