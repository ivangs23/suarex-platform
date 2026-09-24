import {
  attachPaymentIntent,
  cancelOrphanedPendingOrder,
  createPendingOrder,
  markOrderPaid,
  markStationDone,
  reservePrinted,
  unprintedPaidOrders,
} from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

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
  reciboPrinterId: string;
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
  // Impresora de RECIBO del totem. En pedidos de QR no es de destino (no los retiene); solo
  // cuenta para los de canal kiosko. Se siembra en todos los locales para el caso kiosko.
  const { data: reciboPrinter } = await admin
    .from("printers")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: `Recibo ${label}`,
      connection: { type: "network", host: "127.0.0.1", port: 9102 },
      destination: "recibo",
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
    reciboPrinterId: reciboPrinter?.id as string,
  };
}

/**
 * Local igual que `seedVenueWithPrinters` (mismas categorías/productos de cocina Y de
 * barra, así que se pueden montar pedidos que necesiten cualquier combinación de
 * estaciones), pero con impresoras habilitadas SOLO para las estaciones listadas en
 * `enabledFor` -- para fijar el caso "estación necesaria sin ninguna impresora
 * habilitada" (Finding 1 de la revisión de C1 task 4: ver el trade-off documentado en
 * `targetPrinterIds`, `packages/db/src/print-jobs.ts`, y en el comentario de
 * `coalesce(bool_and(...), true)` de `supabase/migrations/20260722000003_print_reservation.sql`).
 * Las estaciones NO listadas en `enabledFor` quedan con `kitchenPrinterId`/`barPrinterId`
 * a `null` -- cero impresoras habilitadas de ese destino en este local.
 */
async function seedVenueWithPrintersFor(
  tenant: TenantFixture,
  label: string,
  enabledFor: readonly ("cocina" | "barra")[],
): Promise<
  Omit<Venue, "kitchenPrinterId" | "barPrinterId" | "reciboPrinterId"> & {
    kitchenPrinterId: string | null;
    barPrinterId: string | null;
  }
> {
  // `is_default: false` -- a propósito, a diferencia de seedVenueWithPrinters: esta
  // función crea locales ADICIONALES para un tenant que, en estos tests, ya tiene su
  // propio local por defecto (el `venue` compartido de `beforeAll`). `venues_single_default_per_tenant`
  // es un UNIQUE parcial sobre `tenant_id where is_default`, así que un segundo local
  // `is_default: true` del MISMO tenant violaría esa restricción. `is_default` no lo lee
  // ningún código de este fichero (siempre se pasa `venueId` explícito), así que `false`
  // aquí no afecta a nada de lo que se prueba.
  const { data: venueRow, error: venueError } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${label}`, name: "V", is_default: false })
    .select("id")
    .single();
  if (venueError) throw venueError;
  const venueId = venueRow?.id as string;

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

  let kitchenPrinterId: string | null = null;
  if (enabledFor.includes("cocina")) {
    const { data: kitchenPrinter, error: kitchenPrinterError } = await admin
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
    if (kitchenPrinterError) throw kitchenPrinterError;
    kitchenPrinterId = kitchenPrinter?.id as string;
  }

  let barPrinterId: string | null = null;
  if (enabledFor.includes("barra")) {
    const { data: barPrinter, error: barPrinterError } = await admin
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
    if (barPrinterError) throw barPrinterError;
    barPrinterId = barPrinter?.id as string;
  }

  return {
    venueId,
    tableId: table?.id as string,
    kitchenProductId: kitchenProduct?.id as string,
    barProductId: barProduct?.id as string,
    kitchenPrinterId,
    barPrinterId,
  };
}

/** Pedido con una línea de cocina y una de barra (paga las dos impresoras), marcado `paid`. */
async function createPaidMixedOrder(
  tenant: TenantFixture,
  venue: Pick<Venue, "venueId" | "tableId" | "kitchenProductId" | "barProductId">,
): Promise<string> {
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

/** Pedido de canal KIOSKO (totem) con una línea de cocina, mesa tecleada, marcado `paid`. Su
 *  impresora de destino incluye la de recibo, además de la de cocina. */
async function createPaidKioskoOrder(
  tenant: TenantFixture,
  venue: Pick<Venue, "venueId" | "kitchenProductId">,
): Promise<string> {
  const order = await createPendingOrder({
    tenantId: tenant.tenantId,
    venueId: venue.venueId,
    tableId: null,
    tableLabel: "7",
    channel: "kiosko",
    lines: [{ productId: venue.kitchenProductId, quantity: 1, extraIds: [], notes: null }],
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
async function createPaidDrinksOnlyOrder(
  tenant: TenantFixture,
  venue: Pick<Venue, "venueId" | "tableId" | "barProductId">,
): Promise<string> {
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

/** Fixtures de tenant "ajeno"/"propio" creadas ad hoc dentro de tests concretos
 * (aislamiento cross-tenant, o un tenant propio para no interferir con el
 * compartido), acumuladas aquí para que un único `afterAll` las borre todas --
 * acotado a exactamente las fixtures que este fichero crea, nunca un wipe. */
const extraFixtures: TenantFixture[] = [];

async function createExtraTenantFixture(slug: string): Promise<TenantFixture> {
  const fixture = await createTenantFixture(slug);
  extraFixtures.push(fixture);
  return fixture;
}

afterAll(async () => {
  if (tenant) await deleteTenantFixture(tenant);
  for (const fixture of extraFixtures) {
    await deleteTenantFixture(fixture);
  }
});

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

    const otherTenant = await createExtraTenantFixture(`prn-otro-${nonce()}`);
    const otherVenue = await seedVenueWithPrinters(otherTenant, nonce());
    const otherOrderId = await createPaidMixedOrder(otherTenant, otherVenue);

    const pending = await unprintedPaidOrders(tenant.tenantId);
    // Control positivo: el propio pedido SÍ aparece.
    expect(pending.some((o) => o.id === orderId)).toBe(true);
    // El pedido ajeno nunca aparece, aunque también esté pagado y sin imprimir.
    expect(pending.some((o) => o.id === otherOrderId)).toBe(false);
  });
});

/**
 * Revisión final whole-branch (seam entre fases): `unprintedPaidOrders` filtraba por
 * `status = 'paid'`, pero `paid` NO es un estado estable -- el trigger `orders_auto_serve`
 * (`20260721000008_orders_auto_serve.sql`) puede saltar de `paid` a `served` en la MISMA
 * sentencia que lo marca pagado, si el personal ya había resuelto ambas estaciones ANTES
 * de que el webhook de Stripe confirmara el cobro (el tablero de cocina/barra no espera al
 * pago -- ver `listActiveOrders`, `packages/db/src/staff-orders.ts`). El pedido nunca
 * "descansa" en `paid`, así que un filtro `status = 'paid'` nunca lo ve: su ticket no se
 * imprime jamás y nada lo registra ("targets vacío = trivialmente cubierto" no aplica
 * aquí -- el pedido ni siquiera entra en la consulta).
 *
 * Este test reproduce el camino EXACTO que dispara el seam, con las mismas funciones que
 * usa el personal/webhook reales (no un UPDATE directo a status='served'):
 *   1. `createPendingOrder`: pedido `pending` con línea de cocina Y de barra.
 *   2. `attachPaymentIntent`: liga el `stripe_payment_intent_id` que usará el webhook.
 *   3. `markStationDone` para AMBAS estaciones, mientras el pedido sigue `pending` -- el
 *      trigger no actúa todavía (`new.status in ('paid','preparing')` es falso).
 *   4. `markOrderPaid`: el UPDATE deja `status='paid'` y `paid_at` en la misma sentencia
 *      que el trigger reevalúa -- como las dos estaciones YA estaban `done`, salta directo
 *      a `served` sin que el pedido llegue a persistir como `paid`.
 *
 * DEBE fallar contra `status = 'paid'` (el pedido ya está `served`, nunca `paid`) y DEBE
 * pasar contra el predicado corregido `paid_at is not null and printed_at is null`
 * (estable frente al avance de `status`, ver `unprintedPaidOrders` en
 * `packages/db/src/print-jobs.ts`).
 */
describe("unprintedPaidOrders — seam: estaciones resueltas ANTES del pago (revisión final whole-branch)", () => {
  it("un pedido que salta paid→served en el propio markOrderPaid sigue apareciendo como pendiente de imprimir", async () => {
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

    const paymentIntentId = `pi_seam_${nonce()}`;
    await attachPaymentIntent(tenant.tenantId, order.orderId, paymentIntentId);

    // El personal resuelve las dos estaciones en el tablero ANTES de que Stripe confirme
    // el cobro -- el pedido sigue `pending` en este punto, el trigger no ha actuado.
    await markStationDone(tenant.tenantId, order.orderId, "cocina");
    await markStationDone(tenant.tenantId, order.orderId, "barra");

    const outcome = await markOrderPaid(paymentIntentId);
    expect(outcome).toBe("marked");

    // Control: el pedido de verdad saltó pending -> served, nunca se quedó en `paid`, y
    // sigue sin imprimir -- exactamente el estado que el print-agent de recuperación debe
    // poder recuperar.
    const { data: row, error: rowError } = await admin
      .from("orders")
      .select("status, paid_at, printed_at, kitchen_status, bar_status")
      .eq("id", order.orderId)
      .single();
    if (rowError) throw rowError;
    expect(row?.status).toBe("served");
    expect(row?.paid_at).not.toBeNull();
    expect(row?.printed_at).toBeNull();
    expect(row?.kitchen_status).toBe("done");
    expect(row?.bar_status).toBe("done");

    // La aserción que reproduce el seam: contra `status = 'paid'` este pedido (ya
    // `served`) NUNCA aparece aquí y el test FALLA. Contra `paid_at is not null and
    // printed_at is null` sigue apareciendo, porque de verdad está pagado y sin imprimir.
    const pending = await unprintedPaidOrders(tenant.tenantId);
    const found = pending.find((o) => o.id === order.orderId);
    expect(found).toBeDefined();
    expect(found?.items.map((i) => i.destination).sort()).toEqual(["barra", "cocina"]);
  });

  it("un pedido cancelado (nunca pagado) no aparece nunca como pendiente de imprimir", async () => {
    const order = await createPendingOrder({
      tenantId: tenant.tenantId,
      venueId: venue.venueId,
      tableId: venue.tableId,
      lines: [{ productId: venue.barProductId, quantity: 1, extraIds: [], notes: null }],
      taxRate: 0.1,
    });

    // Mismo camino que un carrito abandonado / fallo de Stripe justo tras crear el
    // pedido: `cancelOrphanedPendingOrder` solo actúa sobre `pending` y jamás toca
    // `paid_at` (nunca hubo cobro) -- ver `packages/db/src/orders.ts`.
    await cancelOrphanedPendingOrder(tenant.tenantId, order.orderId);

    const { data: row, error: rowError } = await admin
      .from("orders")
      .select("status, paid_at")
      .eq("id", order.orderId)
      .single();
    if (rowError) throw rowError;
    expect(row?.status).toBe("cancelled");
    expect(row?.paid_at).toBeNull();

    const pending = await unprintedPaidOrders(tenant.tenantId);
    expect(pending.some((o) => o.id === order.orderId)).toBe(false);
  });
});

/**
 * Finding 1 de la revisión de C1 task 4: la rama "trivialmente cubierto" (estación
 * necesaria pero cero impresoras habilitadas) es la lógica de mayor riesgo de toda la
 * tarea -- decide entre "el pedido se queda atascado sin imprimir para siempre" y "el
 * pedido se da por completo aunque una estación nunca recibió su ticket" -- y antes de
 * este cambio no tenía ningún test que la ejerciera. Estos tests fijan el
 * comportamiento CONFIRMADO CORRECTO (ver el trade-off documentado en
 * `targetPrinterIds`, `packages/db/src/print-jobs.ts`, y en el comentario de
 * `coalesce(bool_and(...), true)` de
 * `supabase/migrations/20260722000003_print_reservation.sql`) para que un cambio futuro
 * no pueda romperlo en silencio.
 */
describe("unprintedPaidOrders / reservePrinted — estación necesaria sin impresoras habilitadas", () => {
  it("pedido que necesita SOLO una estación sin ninguna impresora habilitada: trivialmente cubierto desde el principio", async () => {
    // Local con impresora SOLO de cocina -- CERO impresoras habilitadas para barra.
    const barlessVenue = await seedVenueWithPrintersFor(tenant, nonce(), ["cocina"]);
    const orderId = await createPaidDrinksOnlyOrder(tenant, barlessVenue); // solo necesita barra

    // Trivialmente cubierto DESDE EL PRINCIPIO: barra no tiene ninguna impresora
    // habilitada, así que no hay ningún id de impresora pendiente de cubrir -- el pedido
    // nunca aparece como pendiente, ni siquiera antes de llamar a reservePrinted.
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(false);

    const { data: before } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", orderId)
      .single();
    expect(before?.printed_at).toBeNull(); // aún no se ha llamado a reservePrinted

    // La cobertura vacía es trivialmente `true`: CUALQUIER llamada a reservePrinted para
    // este pedido -- aquí, con la impresora de cocina del local, aunque el pedido no
    // tenga ninguna línea de cocina -- basta para fijar printed_at, precisamente porque
    // no hay ningún id de impresora de destino que bloquee la cobertura.
    await reservePrinted(
      tenant.tenantId,
      orderId,
      barlessVenue.kitchenPrinterId as string,
      new Date().toISOString(),
    );

    const { data: after } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", orderId)
      .single();
    expect(after?.printed_at).not.toBeNull();
  });

  it("pedido mixto con barra sin ninguna impresora habilitada: reservar SOLO la de cocina lo completa", async () => {
    const cocinaOnlyVenue = await seedVenueWithPrintersFor(tenant, nonce(), ["cocina"]);
    const orderId = await createPaidMixedOrder(tenant, cocinaOnlyVenue);

    // Control positivo: cocina SÍ tiene impresora y aún no se ha reservado, así que el
    // pedido sigue pendiente (no es un caso trivial todavía).
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(true);

    await reservePrinted(
      tenant.tenantId,
      orderId,
      cocinaOnlyVenue.kitchenPrinterId as string,
      new Date().toISOString(),
    );

    // Barra necesitaba una impresora que no existe -- trivialmente cubierta -- así que
    // reservar SOLO la impresora de cocina (la "otra" estación, la que sí tiene
    // impresora real) basta para completar el pedido.
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(false);
    const { data } = await admin.from("orders").select("printed_at").eq("id", orderId).single();
    expect(data?.printed_at).not.toBeNull();
  });

  it("impresora deshabilitada DESPUÉS de crear el pedido: la finalización cuenta solo impresoras actualmente habilitadas", async () => {
    // Tenant y local PROPIOS de este test (no el `tenant`/`venue` compartidos del
    // fichero) para poder deshabilitar una impresora sin afectar a otros tests: por un
    // lado `venues_single_default_per_tenant` impide un segundo local `is_default` en el
    // tenant compartido, y por otro deshabilitar la impresora de barra del `venue`
    // compartido rompería los demás tests de este fichero que siguen necesitándola.
    const ownTenant = await createExtraTenantFixture(`prn-disable-${nonce()}`);
    const ownVenue = await seedVenueWithPrinters(ownTenant, nonce());
    const orderId = await createPaidMixedOrder(ownTenant, ownVenue);

    // Control positivo: con las dos impresoras todavía habilitadas, el pedido está pendiente.
    expect((await unprintedPaidOrders(ownTenant.tenantId)).some((o) => o.id === orderId)).toBe(
      true,
    );

    // La impresora de barra se deshabilita DESPUÉS de crear el pedido (p. ej. alguien la
    // apaga o la retira de la configuración) y ANTES de que nadie la reserve.
    const { error: disableError } = await admin
      .from("printers")
      .update({ enabled: false })
      .eq("id", ownVenue.barPrinterId);
    if (disableError) throw disableError;

    await reservePrinted(
      ownTenant.tenantId,
      orderId,
      ownVenue.kitchenPrinterId,
      new Date().toISOString(),
    );

    // reservePrinted (SQL) y unprintedPaidOrders (TS) recalculan las impresoras de
    // destino EN CADA llamada -- no las congelan en el momento de crear el pedido -- así
    // que barra, ahora sin ninguna impresora habilitada, se trata como trivialmente
    // cubierta y reservar solo cocina basta para completar el pedido.
    expect((await unprintedPaidOrders(ownTenant.tenantId)).some((o) => o.id === orderId)).toBe(
      false,
    );
    const { data } = await admin.from("orders").select("printed_at").eq("id", orderId).single();
    expect(data?.printed_at).not.toBeNull();
  });
});

/**
 * Finding 3 de la revisión de C1 task 4: el mapeo estación→impresora vive duplicado en
 * `targetPrinterIds` (TS, `packages/db/src/print-jobs.ts`) y en `reserve_printed` (SQL,
 * `supabase/migrations/20260722000003_print_reservation.sql`), con comentarios de "keep
 * in sync" en ambos lados pero sin ninguna prueba que lo confirme. Este test ejerce un
 * caso NO trivial (una impresora de cocina Y una de barra, ambas habilitadas, reserva
 * PARCIAL) y comprueba que las DOS implementaciones -- `unprintedPaidOrders` (TS) y el
 * `printed_at` que fija `reservePrinted` (SQL) -- coinciden en cada paso, para que una
 * futura divergencia entre ambas quede atrapada aquí.
 */
describe("unprintedPaidOrders / reservePrinted — acuerdo SQL/TS en el mapeo estación→impresora", () => {
  it("con una impresora de cocina y una de barra habilitadas, TS y SQL coinciden en cada paso de una reserva parcial", async () => {
    const orderId = await createPaidMixedOrder(tenant, venue);

    // Antes de reservar nada: las dos implementaciones coinciden en "pendiente".
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(true);
    const rowBefore = (await admin.from("orders").select("printed_at").eq("id", orderId).single())
      .data;
    expect(rowBefore?.printed_at).toBeNull();

    // Reserva PARCIAL: solo cocina.
    const atKitchen = new Date().toISOString();
    await reservePrinted(tenant.tenantId, orderId, venue.kitchenPrinterId, atKitchen);

    // Tras la reserva parcial: las dos siguen de acuerdo en "pendiente" (falta barra en
    // ambas -- ni TS deja de listarlo ni SQL fija printed_at).
    const pendingAfterPartial = await unprintedPaidOrders(tenant.tenantId);
    const foundAfterPartial = pendingAfterPartial.find((o) => o.id === orderId);
    expect(foundAfterPartial).toBeDefined(); // TS: sigue pendiente
    expect(foundAfterPartial?.printedTargets).toEqual({ [venue.kitchenPrinterId]: atKitchen });
    const rowAfterPartial = (
      await admin.from("orders").select("printed_at").eq("id", orderId).single()
    ).data;
    expect(rowAfterPartial?.printed_at).toBeNull(); // SQL: tampoco cubierto todavía

    // Reserva COMPLETA: barra también.
    await reservePrinted(tenant.tenantId, orderId, venue.barPrinterId, new Date().toISOString());

    // Tras cubrir ambas impresoras: las dos implementaciones coinciden en "completo".
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(false);
    const rowAfterFull = (
      await admin.from("orders").select("printed_at").eq("id", orderId).single()
    ).data;
    expect(rowAfterFull?.printed_at).not.toBeNull();
  });

  it("un pedido kiosko no queda impreso hasta que TAMBIÉN se cubre la impresora de recibo", async () => {
    // La regla del recibo (canal kiosko -> el recibo es de destino) vive en TS (`targetPrinterIds`)
    // y en SQL (`reserve_printed`, 20260724000005_recibo_printer.sql). Este caso las ejerce a la
    // vez: con la comanda de cocina cubierta pero el recibo no, las dos deben seguir en "pendiente".
    const orderId = await createPaidKioskoOrder(tenant, venue);

    // Reserva solo la comanda de cocina.
    await reservePrinted(
      tenant.tenantId,
      orderId,
      venue.kitchenPrinterId,
      new Date().toISOString(),
    );
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(true);
    const midRow = (await admin.from("orders").select("printed_at").eq("id", orderId).single())
      .data;
    expect(midRow?.printed_at).toBeNull(); // SQL: falta el recibo

    // Ahora el recibo: las dos implementaciones pasan a "completo".
    await reservePrinted(tenant.tenantId, orderId, venue.reciboPrinterId, new Date().toISOString());
    expect((await unprintedPaidOrders(tenant.tenantId)).some((o) => o.id === orderId)).toBe(false);
    const fullRow = (await admin.from("orders").select("printed_at").eq("id", orderId).single())
      .data;
    expect(fullRow?.printed_at).not.toBeNull();
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
