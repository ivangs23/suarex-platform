import { createDeviceClient, runAgentTick } from "@suarex/agent";
import { afterEach, describe, expect, it } from "vitest";
import { type FakedPrinter, startFakePrinter } from "../helpers/fake-escpos-server.js";
import {
  admin,
  anonKeyForTest,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  supabaseUrlForTest,
  type TenantFixture,
} from "./helpers/tenants.js";

// Siembra un venue de cocina apuntando a una impresora TCP falsa, un pedido pagado,
// y un dispositivo (fila devices + cuenta de Auth con rol device) cuyo cliente devuelve.
type LoopFixture = {
  tenant: TenantFixture;
  orderId: string;
  deviceUserId: string;
  deviceEmail: string;
  devicePassword: string;
};

const openPrinters: FakedPrinter[] = [];
const fixtures: LoopFixture[] = [];

afterEach(async () => {
  await Promise.all(openPrinters.splice(0).map((p) => p.close()));
  for (const f of fixtures.splice(0)) {
    await deleteMembershipFixtureUser(f.deviceUserId);
    await deleteTenantFixture(f.tenant);
  }
});

async function seedLoop(kitchenPort: number): Promise<LoopFixture> {
  const tenant = await createTenantFixture(`loop-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
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
    connection: { type: "network", host: "127.0.0.1", port: kitchenPort },
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

  // Cuenta de Auth del dispositivo + membership rol device + fila devices enlazada.
  const email = `loop-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const deviceUserId = user?.user?.id as string;
  await admin
    .from("memberships")
    .insert({ user_id: deviceUserId, tenant_id: tenant.tenantId, role: "device" });
  await admin.from("devices").insert({
    tenant_id: tenant.tenantId,
    venue_id: venueId,
    name: "Agente",
    auth_user_id: deviceUserId,
    paired_at: new Date().toISOString(),
  });
  return {
    tenant,
    orderId: order.orderId,
    deviceUserId,
    deviceEmail: email,
    devicePassword: password,
  };
}

/** Variante de `seedLoop` para probar impresoras 'all': un venue con UNA categoría/producto
 * de cocina ("Paella") Y una de barra ("Cerveza"), un pedido pagado que pide ambos, y una
 * única impresora de red con `destination: "all"` apuntando a `allPort`. */
async function seedAllPrinterLoop(allPort: number): Promise<LoopFixture> {
  const tenant = await createTenantFixture(`loop-all-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  const venueId = venue?.id as string;
  const { data: kitchenCat } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `k-${nonce()}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    })
    .select("id")
    .single();
  const { data: kitchenProd } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: kitchenCat?.id,
      name_i18n: { es: "Paella" },
      price: 12,
    })
    .select("id")
    .single();
  const { data: barCat } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `b-${nonce()}`,
      name_i18n: { es: "Barra" },
      destination: "barra",
    })
    .select("id")
    .single();
  const { data: barProd } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: barCat?.id,
      name_i18n: { es: "Cerveza" },
      price: 3,
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
    name: "Todos",
    connection: { type: "network", host: "127.0.0.1", port: allPort },
    destination: "all",
    enabled: true,
  });
  const { createPendingOrder } = await import("@suarex/db");
  const order = await createPendingOrder({
    tenantId: tenant.tenantId,
    venueId,
    tableId: table?.id as string,
    lines: [
      { productId: kitchenProd?.id as string, quantity: 1, extraIds: [], notes: null },
      { productId: barProd?.id as string, quantity: 1, extraIds: [], notes: null },
    ],
    taxRate: 0.1,
  });
  await admin
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.orderId);

  // Cuenta de Auth del dispositivo + membership rol device + fila devices enlazada.
  const email = `loop-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const deviceUserId = user?.user?.id as string;
  await admin
    .from("memberships")
    .insert({ user_id: deviceUserId, tenant_id: tenant.tenantId, role: "device" });
  await admin.from("devices").insert({
    tenant_id: tenant.tenantId,
    venue_id: venueId,
    name: "Agente",
    auth_user_id: deviceUserId,
    paired_at: new Date().toISOString(),
  });
  return {
    tenant,
    orderId: order.orderId,
    deviceUserId,
    deviceEmail: email,
    devicePassword: password,
  };
}

/**
 * Variante de `seedLoop` para el Finding 1 de la revisión final whole-branch (ceguera de
 * venue en el bucle de entrega): UN tenant con DOS locales (V1/V2), cada uno con su propia
 * impresora de cocina habilitada (P1 en V1 apunta a `port1`, P2 en V2 apunta a `port2`), y
 * un pedido de cocina pagado que pertenece SOLO a V1. El dispositivo (rol `device`) lee
 * TODAS las impresoras habilitadas del tenant vía RLS (fencing D2), sin importar su propio
 * `venue_id` -- por eso el bucle de entrega es quien debe filtrar por el venue DEL PEDIDO,
 * no la lectura. Contra el código ANTERIOR a este fix (sin el guard `printer.venue_id !==
 * order.venueId`), P2 también habría impreso el pedido de V1 -- el mismo ticket, físicamente
 * en el restaurante equivocado.
 */
async function seedTwoVenueLoop(
  port1: number,
  port2: number,
): Promise<LoopFixture & { venue1Id: string; venue2Id: string }> {
  const tenant = await createTenantFixture(`loop-2v-${nonce()}`);
  const { data: venue1 } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v1-${nonce()}`, name: "V1", is_default: true })
    .select("id")
    .single();
  const venue1Id = venue1?.id as string;
  const { data: venue2 } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v2-${nonce()}`, name: "V2", is_default: false })
    .select("id")
    .single();
  const venue2Id = venue2?.id as string;

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
    .insert({ tenant_id: tenant.tenantId, venue_id: venue1Id, label: `mesa-${nonce()}` })
    .select("id")
    .single();

  // P1: impresora de cocina de V1, apunta a la impresora falsa 1.
  await admin.from("printers").insert({
    tenant_id: tenant.tenantId,
    venue_id: venue1Id,
    name: "Cocina V1",
    connection: { type: "network", host: "127.0.0.1", port: port1 },
    destination: "cocina",
    enabled: true,
  });
  // P2: impresora de cocina de V2 -- mismo destino, OTRO local.
  await admin.from("printers").insert({
    tenant_id: tenant.tenantId,
    venue_id: venue2Id,
    name: "Cocina V2",
    connection: { type: "network", host: "127.0.0.1", port: port2 },
    destination: "cocina",
    enabled: true,
  });

  // Pedido de cocina pagado, SOLO de V1.
  const { createPendingOrder } = await import("@suarex/db");
  const order = await createPendingOrder({
    tenantId: tenant.tenantId,
    venueId: venue1Id,
    tableId: table?.id as string,
    lines: [{ productId: prod?.id as string, quantity: 1, extraIds: [], notes: null }],
    taxRate: 0.1,
  });
  await admin
    .from("orders")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", order.orderId);

  // Cuenta de Auth del dispositivo + membership rol device + fila devices enlazada a V1
  // (el dispositivo lee TODAS las impresoras del tenant por RLS, no solo las de su propio
  // venue -- su `venue_id` no es lo que decide qué se filtra aquí, ver la nota de arriba).
  const email = `loop-2v-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  const deviceUserId = user?.user?.id as string;
  await admin
    .from("memberships")
    .insert({ user_id: deviceUserId, tenant_id: tenant.tenantId, role: "device" });
  await admin.from("devices").insert({
    tenant_id: tenant.tenantId,
    venue_id: venue1Id,
    name: "Agente",
    auth_user_id: deviceUserId,
    paired_at: new Date().toISOString(),
  });

  return {
    tenant,
    orderId: order.orderId,
    deviceUserId,
    deviceEmail: email,
    devicePassword: password,
    venue1Id,
    venue2Id,
  };
}

describe("runAgentTick", () => {
  it("imprime el pedido pagado en su impresora y lo marca; una segunda pasada no reimprime", async () => {
    const cocina = await startFakePrinter();
    openPrinters.push(cocina);
    const f = await seedLoop(cocina.port);
    fixtures.push(f);

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(),
      anonKey: anonKeyForTest(),
      email: f.deviceEmail,
      password: f.devicePassword,
    });

    const r1 = await runAgentTick(client);
    expect(r1.printed).toBe(1);
    expect(cocina.connectionCount()).toBe(1);
    expect(cocina.received().toString("latin1")).toContain("Paella");

    const { data: row } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", f.orderId)
      .single();
    expect(row?.printed_at).not.toBeNull();

    const r2 = await runAgentTick(client);
    expect(r2.printed).toBe(0);
    expect(cocina.connectionCount()).toBe(1); // no reconecta
  });

  it("una impresora caída no se marca; el siguiente tick la reintenta", async () => {
    const cocina = await startFakePrinter();
    openPrinters.push(cocina);
    const f = await seedLoop(cocina.port);
    fixtures.push(f);
    cocina.failAllConnections();

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(),
      anonKey: anonKeyForTest(),
      email: f.deviceEmail,
      password: f.devicePassword,
    });

    const r1 = await runAgentTick(client);
    expect(r1.printed).toBe(0);
    expect(r1.failed).toBe(1);
    const { data: afterFail } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", f.orderId)
      .single();
    expect(afterFail?.printed_at).toBeNull(); // NO se da por impreso

    cocina.recoverConnections();
    const r2 = await runAgentTick(client);
    expect(r2.printed).toBe(1);
    const { data: afterOk } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", f.orderId)
      .single();
    expect(afterOk?.printed_at).not.toBeNull();
  }, 30_000); // los 3 reintentos con back-off real de printToPrinter

  it("una impresora 'all' imprime TODOS los destinos del pedido, no solo uno", async () => {
    const todos = await startFakePrinter();
    openPrinters.push(todos);
    const f = await seedAllPrinterLoop(todos.port);
    fixtures.push(f);

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(),
      anonKey: anonKeyForTest(),
      email: f.deviceEmail,
      password: f.devicePassword,
    });

    const r1 = await runAgentTick(client);
    expect(r1.printed).toBe(1);
    const received = todos.received().toString("latin1");
    expect(received).toContain("Paella");
    expect(received).toContain("Cerveza");

    const { data: row } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", f.orderId)
      .single();
    expect(row?.printed_at).not.toBeNull();

    const r2 = await runAgentTick(client);
    expect(r2.printed).toBe(0);
    expect(todos.connectionCount()).toBe(1); // no reconecta
  });

  it("Finding 1 (revisión final whole-branch): un pedido de V1 imprime SOLO en la impresora de V1, nunca en la de V2", async () => {
    const p1 = await startFakePrinter();
    const p2 = await startFakePrinter();
    openPrinters.push(p1, p2);
    const f = await seedTwoVenueLoop(p1.port, p2.port);
    fixtures.push(f);

    const client = await createDeviceClient({
      supabaseUrl: supabaseUrlForTest(),
      anonKey: anonKeyForTest(),
      email: f.deviceEmail,
      password: f.devicePassword,
    });

    const r1 = await runAgentTick(client);
    expect(r1.printed).toBe(1);

    // P1 (V1, dueño real del pedido) SÍ recibió el ticket.
    expect(p1.connectionCount()).toBe(1);
    expect(p1.received().toString("latin1")).toContain("Paella");

    // P2 (V2, mismo destino "cocina" pero OTRO local) NO debe recibir nada. Contra el
    // código ANTERIOR a este fix (sin el guard de venue en runAgentTick), P2 también se
    // conectaba e imprimía este mismo pedido -- este assert es el que falla sin el fix.
    expect(p2.connectionCount()).toBe(0);
    expect(p2.received().toString("latin1")).toBe("");

    const { data: row } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", f.orderId)
      .single();
    expect(row?.printed_at).not.toBeNull();
  });
});
