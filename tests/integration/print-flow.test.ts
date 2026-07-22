import { createPendingOrder, reservePrinted, unprintedPaidOrders } from "@suarex/db";
import { type PrinterConfig, printToPrinter } from "@suarex/printing";
import { buildTicketLines, type TicketBranding, type TicketOrder } from "@suarex/ticket";
import { afterEach, describe, expect, it } from "vitest";
import { type FakedPrinter, startFakePrinter } from "../helpers/fake-escpos-server.js";
import { admin, createTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

/**
 * Prueba de extremo a extremo de la fase C1: un pedido pagado se convierte en
 * bytes ESC/POS, en la impresora correcta, una sola vez, y se recupera si la
 * impresora estaba caída -- todo contra impresoras falsas, sin hardware. No
 * añade ningún módulo de producción nuevo: compone las cuatro piezas ya
 * construidas y revisadas (`@suarex/ticket`, `@suarex/printing`, `@suarex/db`, y
 * el servidor ESC/POS falso de `tests/helpers/fake-escpos-server.ts`).
 */

type FlowVenue = {
  venueId: string;
  tableId: string;
  kitchenProductId: string;
  barProductId: string;
  kitchenPrinterId: string;
  barPrinterId: string;
};

/**
 * Local con una impresora de cocina y una de barra, apuntando cada una al
 * puerto de una impresora falsa concreta (a diferencia de `print-jobs.test.ts`,
 * que fija 9100/9101 porque nunca conecta de verdad -- aquí SÍ hay un socket
 * real al otro lado, así que el puerto tiene que ser el que el harness asignó).
 */
async function seedVenueForFlow(
  tenant: TenantFixture,
  label: string,
  kitchenPort: number,
  barPort: number,
): Promise<FlowVenue> {
  const { data: venue, error: venueError } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${label}`, name: "V", is_default: true })
    .select("id")
    .single();
  if (venueError) throw venueError;
  const venueId = venue?.id as string;

  const { data: kitchenCategory, error: kitchenCategoryError } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `k-${label}`,
      name_i18n: { es: "Cocina" },
      destination: "cocina",
    })
    .select("id")
    .single();
  if (kitchenCategoryError) throw kitchenCategoryError;

  const { data: barCategory, error: barCategoryError } = await admin
    .from("categories")
    .insert({
      tenant_id: tenant.tenantId,
      slug: `b-${label}`,
      name_i18n: { es: "Barra" },
      destination: "barra",
    })
    .select("id")
    .single();
  if (barCategoryError) throw barCategoryError;

  const { data: kitchenProduct, error: kitchenProductError } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: kitchenCategory?.id,
      name_i18n: { es: "Paella" },
      price: 12,
    })
    .select("id")
    .single();
  if (kitchenProductError) throw kitchenProductError;

  const { data: barProduct, error: barProductError } = await admin
    .from("products")
    .insert({
      tenant_id: tenant.tenantId,
      category_id: barCategory?.id,
      name_i18n: { es: "Cerveza" },
      price: 3,
    })
    .select("id")
    .single();
  if (barProductError) throw barProductError;

  const { data: table, error: tableError } = await admin
    .from("tables")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, label: `mesa-${label}` })
    .select("id")
    .single();
  if (tableError) throw tableError;

  const { data: kitchenPrinter, error: kitchenPrinterError } = await admin
    .from("printers")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: `Cocina ${label}`,
      connection: { type: "network", host: "127.0.0.1", port: kitchenPort },
      destination: "cocina",
      enabled: true,
    })
    .select("id")
    .single();
  if (kitchenPrinterError) throw kitchenPrinterError;

  const { data: barPrinter, error: barPrinterError } = await admin
    .from("printers")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: `Barra ${label}`,
      connection: { type: "network", host: "127.0.0.1", port: barPort },
      destination: "barra",
      enabled: true,
    })
    .select("id")
    .single();
  if (barPrinterError) throw barPrinterError;

  return {
    venueId,
    tableId: table?.id as string,
    kitchenProductId: kitchenProduct?.id as string,
    barProductId: barProduct?.id as string,
    kitchenPrinterId: kitchenPrinter?.id as string,
    barPrinterId: barPrinter?.id as string,
  };
}

/** Pedido con una línea de cocina y una de barra, marcado `paid`. */
async function createPaidMixedOrder(tenant: TenantFixture, venue: FlowVenue): Promise<string> {
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

type FlowPrinter = {
  id: string;
  label: string;
  destination: "cocina" | "barra";
  host: string;
  port: number;
};

/**
 * El "flujo" en sí: compone las cuatro piezas. Por cada pedido pagado sin
 * imprimir del tenant (`unprintedPaidOrders`), y por cada impresora de destino
 * que ese pedido todavía no tiene en `printedTargets`, construye su ticket
 * (`buildTicketLines`), lo entrega (`printToPrinter`) y, solo si la entrega fue
 * de verdad exitosa, reserva esa impresora para ese pedido (`reservePrinted`).
 *
 * La comprobación de `printedTargets` por impresora (no solo el filtro de
 * `unprintedPaidOrders` a nivel de pedido) es lo que hace que una segunda
 * pasada -- ya sea la repetición de una que tuvo éxito completo, ya sea el
 * reintento del reconciler tras un fallo parcial -- nunca reenvíe a una
 * impresora que ya imprimió: ni reconecta con ella, ni la reserva dos veces.
 */
async function runPrintFlowOnce(
  tenantId: string,
  branding: TicketBranding,
  printers: FlowPrinter[],
): Promise<void> {
  const pendingOrders = await unprintedPaidOrders(tenantId);

  for (const order of pendingOrders) {
    const ticketOrder: TicketOrder = {
      orderNumber: order.orderNumber,
      tableLabel: order.tableLabel,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        destination: item.destination,
        extras: [],
      })),
    };
    const neededDestinations = new Set(order.items.map((item) => item.destination));

    for (const printer of printers) {
      if (!neededDestinations.has(printer.destination)) continue;
      if (Object.hasOwn(order.printedTargets, printer.id)) continue;

      const lines = buildTicketLines(ticketOrder, branding, printer.destination);
      const config: PrinterConfig = {
        id: printer.id,
        label: printer.label,
        destination: printer.destination,
        adapter: "escpos-tcp",
        host: printer.host,
        port: printer.port,
      };
      const result = await printToPrinter(lines, config);
      if (result.ok) {
        await reservePrinted(tenantId, order.id, printer.id, new Date().toISOString());
      }
    }
  }
}

const openPrinters: FakedPrinter[] = [];
afterEach(async () => {
  await Promise.all(openPrinters.splice(0).map((p) => p.close()));
});

describe("flujo de impresión de extremo a extremo — enrutado + idempotencia", () => {
  it("cada impresora recibe SOLO su destino, y una segunda pasada no reconecta con ninguna", async () => {
    const tenant = await createTenantFixture(`flow-${nonce()}`);
    const cocina = await startFakePrinter();
    const barra = await startFakePrinter();
    openPrinters.push(cocina, barra);

    const venue = await seedVenueForFlow(tenant, nonce(), cocina.port, barra.port);
    const orderId = await createPaidMixedOrder(tenant, venue);

    const branding: TicketBranding = { header: `Restaurante ${tenant.slug}` };
    const printers: FlowPrinter[] = [
      {
        id: venue.kitchenPrinterId,
        label: "Cocina",
        destination: "cocina",
        host: "127.0.0.1",
        port: cocina.port,
      },
      {
        id: venue.barPrinterId,
        label: "Barra",
        destination: "barra",
        host: "127.0.0.1",
        port: barra.port,
      },
    ];

    // --- Pasada 1: construye, entrega y reserva cada destino ---
    await runPrintFlowOnce(tenant.tenantId, branding, printers);

    expect(cocina.connectionCount()).toBe(1);
    expect(barra.connectionCount()).toBe(1);

    // Enrutado -- la prueba que de verdad importa -- sobre los BYTES capturados,
    // no sobre un recuento: la de cocina recibe su ítem y NO el de barra, y viceversa.
    const cocinaBytes = cocina.received().toString("latin1");
    const barraBytes = barra.received().toString("latin1");
    expect(cocinaBytes).toContain("Paella");
    expect(cocinaBytes).not.toContain("Cerveza");
    expect(barraBytes).toContain("Cerveza");
    expect(barraBytes).not.toContain("Paella");

    // Ambas impresoras de destino quedaron reservadas -> el pedido deja de estar pendiente.
    const stillPending = await unprintedPaidOrders(tenant.tenantId);
    expect(stillPending.some((o) => o.id === orderId)).toBe(false);
    const { data: row } = await admin
      .from("orders")
      .select("printed_at, printed_targets")
      .eq("id", orderId)
      .single();
    expect(row?.printed_at).not.toBeNull();
    expect(Object.keys(row?.printed_targets ?? {}).sort()).toEqual(
      [venue.barPrinterId, venue.kitchenPrinterId].sort(),
    );

    // --- Pasada 2: idempotencia de punta a punta (printed_targets/unprintedPaidOrders) ---
    await runPrintFlowOnce(tenant.tenantId, branding, printers);

    // Ninguna impresora vuelve a conectarse: el pedido ya no aparece como pendiente,
    // así que el bucle del flujo ni siquiera intenta reenviarlo.
    expect(cocina.connectionCount()).toBe(1);
    expect(barra.connectionCount()).toBe(1);
  });
});

describe("flujo de impresión de extremo a extremo — recuperación tras impresora caída", () => {
  it("cocina caída en la primera pasada no se marca impresa; la segunda pasada (reconciler) la completa sin reimprimir barra", async () => {
    const tenant = await createTenantFixture(`flow-rec-${nonce()}`);
    const cocina = await startFakePrinter();
    const barra = await startFakePrinter();
    openPrinters.push(cocina, barra);

    const venue = await seedVenueForFlow(tenant, nonce(), cocina.port, barra.port);
    const orderId = await createPaidMixedOrder(tenant, venue);

    const branding: TicketBranding = { header: `Restaurante ${tenant.slug}` };
    const printers: FlowPrinter[] = [
      {
        id: venue.kitchenPrinterId,
        label: "Cocina",
        destination: "cocina",
        host: "127.0.0.1",
        port: cocina.port,
      },
      {
        id: venue.barPrinterId,
        label: "Barra",
        destination: "barra",
        host: "127.0.0.1",
        port: barra.port,
      },
    ];

    // Cocina simula estar caída: TODAS sus conexiones se tiran, así que
    // `printToPrinter` agota sus reintentos (3 intentos, socket fresco cada
    // vez) y devuelve `ok:false` de verdad. `failNextConnection()` no serviría
    // aquí: un fallo puntual lo absorbe el propio reintento de `printToPrinter`
    // y nunca llega a manifestarse como fallo de la entrega completa (ver el
    // comentario de `recoverConnections()` en `tests/helpers/fake-escpos-server.ts`).
    cocina.failAllConnections();

    // --- Pasada 1 ---
    await runPrintFlowOnce(tenant.tenantId, branding, printers);

    // Barra imprimió y quedó reservada; cocina no llegó a entregar nada.
    expect(barra.connectionCount()).toBe(1);
    expect(cocina.connectionCount()).toBe(3); // los 3 intentos de printToPrinter, todos tirados
    expect(cocina.received().length).toBe(0); // ningún byte llegó a "imprimirse"

    const { data: afterFirstPass } = await admin
      .from("orders")
      .select("printed_at, printed_targets")
      .eq("id", orderId)
      .single();
    expect(afterFirstPass?.printed_at).toBeNull(); // el pedido NO se da por impreso
    expect(Object.keys(afterFirstPass?.printed_targets ?? {})).toEqual([venue.barPrinterId]);

    const pendingAfterFirstPass = await unprintedPaidOrders(tenant.tenantId);
    const foundAfterFirstPass = pendingAfterFirstPass.find((o) => o.id === orderId);
    expect(foundAfterFirstPass).toBeDefined(); // sigue pendiente: falta cocina
    expect(foundAfterFirstPass?.printedTargets).toEqual({
      [venue.barPrinterId]: expect.any(String),
    });

    // La impresora de cocina "vuelve" -- en producción esto es lo que ocurre
    // entre dos ciclos del reconciler, sin que nadie se lo diga explícitamente.
    cocina.recoverConnections();

    // --- Pasada 2 (lo que hará el reconciler) ---
    await runPrintFlowOnce(tenant.tenantId, branding, printers);

    // Cocina, ahora sana, recibe SU ticket -- una conexión más, con los bytes correctos.
    expect(cocina.connectionCount()).toBe(4); // 3 fallidas + 1 exitosa
    const cocinaBytes = cocina.received().toString("latin1");
    expect(cocinaBytes).toContain("Paella");
    expect(cocinaBytes).not.toContain("Cerveza");

    // Barra, que ya había impreso, NO se reimprime: su contador no crece.
    expect(barra.connectionCount()).toBe(1);

    const { data: afterSecondPass } = await admin
      .from("orders")
      .select("printed_at, printed_targets")
      .eq("id", orderId)
      .single();
    expect(afterSecondPass?.printed_at).not.toBeNull();
    expect(Object.keys(afterSecondPass?.printed_targets ?? {}).sort()).toEqual(
      [venue.barPrinterId, venue.kitchenPrinterId].sort(),
    );
  }, 20_000); // 3 intentos fallidos con back-off real de 2 s cada uno (~4-6 s) + margen
});
