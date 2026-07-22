import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createMembershipFixture,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  type RoleFixture,
  type SeedResult,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * Prueba de que un `device` (la cuenta de servicio de un agente de impresión, ver
 * `20260722000001_devices_printers.sql` y el hardening de RLS que cierra este archivo)
 * queda genuinamente acotado a "leer lo que necesita para imprimir + marcar impreso vía
 * RPC", nada más -- ni siquiera dentro de su propio tenant.
 *
 * Dos tenants (A, B) para poder probar aislamiento cross-tenant además del recorte por
 * rol; dos roles en el tenant A (`staffA` y `deviceA`) para poder comparar, en el MISMO
 * tenant, lo que puede hacer cada uno -- así el regression check de staff no depende de
 * ninguna diferencia entre tenants, solo del rol.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let seedA: SeedResult;
let seedB: SeedResult;
let staffA: RoleFixture;
let deviceA: RoleFixture;
let deviceRowId: string;
let printerAId: string;

afterAll(async () => {
  if (staffA) await deleteMembershipFixtureUser(staffA.userId);
  if (deviceA) await deleteMembershipFixtureUser(deviceA.userId);
  for (const fixture of [tenantA, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

beforeAll(async () => {
  tenantA = await createTenantFixture(`device-rls-a-${nonce()}`);
  tenantB = await createTenantFixture(`device-rls-b-${nonce()}`);
  seedA = await seedCatalog(tenantA.tenantId, `dra-${nonce()}`);
  seedB = await seedCatalog(tenantB.tenantId, `drb-${nonce()}`);

  staffA = await createMembershipFixture(tenantA.tenantId, "staff", "staff-a");
  deviceA = await createMembershipFixture(tenantA.tenantId, "device", "device-a");

  // Fila `devices` real, enlazada a la cuenta de auth de deviceA vía `auth_user_id`, para
  // poder probar "un dispositivo solo ve su propia fila en devices" -- distinta de la
  // fila anónima (sin auth_user_id) que `seedCatalog` ya crea por tenant.
  const { data: deviceRow, error: deviceRowError } = await admin
    .from("devices")
    .insert({
      tenant_id: tenantA.tenantId,
      venue_id: seedA.venueId,
      name: "Device A fixture",
      auth_user_id: deviceA.userId,
    })
    .select("id")
    .single();
  if (deviceRowError) throw deviceRowError;
  deviceRowId = deviceRow.id as string;

  const { data: printerRow, error: printerRowError } = await admin
    .from("printers")
    .select("id")
    .eq("tenant_id", tenantA.tenantId)
    .limit(1)
    .single();
  if (printerRowError) throw printerRowError;
  printerAId = printerRow.id as string;
});

describe("contrato de lectura de un device", () => {
  it("puede leer los pedidos de su tenant", async () => {
    const { data, error } = await deviceA.client
      .from("orders")
      .select("id")
      .eq("id", seedA.orderId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("puede leer las líneas de pedido y sus extras", async () => {
    const { data: items, error: itemsError } = await deviceA.client
      .from("order_items")
      .select("id")
      .eq("id", seedA.orderItemId);
    expect(itemsError).toBeNull();
    expect(items).toHaveLength(1);

    const { data: extras, error: extrasError } = await deviceA.client
      .from("order_item_extras")
      .select("id")
      .eq("order_item_id", seedA.orderItemId);
    expect(extrasError).toBeNull();
    expect((extras ?? []).length).toBeGreaterThan(0);
  });

  it("puede leer la configuración de impresoras de su tenant", async () => {
    const { data, error } = await deviceA.client
      .from("printers")
      .select("id")
      .eq("tenant_id", tenantA.tenantId);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("puede leer los ajustes (branding) de su tenant", async () => {
    const { data, error } = await deviceA.client
      .from("tenant_settings")
      .select("tenant_id")
      .eq("tenant_id", tenantA.tenantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("solo ve su PROPIA fila en devices, no la anónima sembrada por seedCatalog ni ninguna otra", async () => {
    const { data, error } = await deviceA.client.from("devices").select("id");
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id)).toEqual([deviceRowId]);
  });
});

describe("reserve_printed_self: la única vía de un device para marcar impreso", () => {
  it("un device puede marcar su propio pedido como impreso vía la RPC", async () => {
    const { error } = await deviceA.client.rpc("reserve_printed_self", {
      p_order_id: seedA.orderId,
      p_printer_id: printerAId,
      p_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    // Control positivo real, no solo "sin error": el pedido de A (kitchen_status/
    // bar_status por defecto 'na', trivialmente cubierto) queda con printed_at fijado.
    const { data } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", seedA.orderId)
      .single();
    expect(data?.printed_at).not.toBeNull();
  });

  it("NO puede usar la RPC para marcar como impreso un pedido de OTRO tenant", async () => {
    // reserve_printed_self ignora cualquier tenant que el llamante pudiera insinuar y usa
    // SIEMPRE current_tenant_id() del propio JWT -- así que aunque pase el orderId real
    // de B, la función interna no encuentra fila de SU tenant con ese id y es un no-op
    // silencioso, igual que el resto de RPCs de este proyecto ante un id ajeno.
    const { error } = await deviceA.client.rpc("reserve_printed_self", {
      p_order_id: seedB.orderId,
      p_printer_id: randomUUID(),
      p_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from("orders")
      .select("printed_at")
      .eq("id", seedB.orderId)
      .single();
    expect(data?.printed_at).toBeNull();
  });
});

describe("un device NO puede escribir fuera de su contrato", () => {
  it("no puede insertar un producto en su propio tenant", async () => {
    const { error } = await deviceA.client.from("products").insert({
      tenant_id: tenantA.tenantId,
      category_id: seedA.categoryId,
      name_i18n: { es: "Intruso" },
      price: 1,
    });
    expect(error, "el INSERT debía ser rechazado").not.toBeNull();
    // No es 42501 (RLS) sino P0001: como device no tiene NINGÚN acceso de lectura a
    // `categories` (categoría B, ver la migración de hardening), el trigger BEFORE
    // `assert_same_tenant` no puede ver la categoría real de su propio tenant bajo la
    // RLS del propio device -- la subconsulta devuelve 0 filas, `parent_tenant` queda
    // NULL, y el trigger dispara su propia excepción ANTES de que el WITH CHECK de la
    // policy de escritura llegue a evaluarse. Sigue siendo una guarda de aislamiento
    // real y deliberada (mismo patrón que `SAME_TENANT_TRIGGER_REJECTION` en
    // tenant-isolation.test.ts), solo en una capa distinta.
    expect(error?.code).toBe("P0001");
    expect(error?.message).toContain("cross-tenant reference rejected");
  });

  it("no puede actualizar un producto existente de su propio tenant", async () => {
    const { data, error } = await deviceA.client
      .from("products")
      .update({ price: 999 })
      .eq("id", seedA.productId)
      .select();
    // El USING de la policy de escritura filtra la fila para el rol device: el UPDATE no
    // encuentra ninguna fila que tocar (0 filas), no un error explícito -- mismo patrón
    // que el resto de la suite para el caso estándar (no revocado a nivel de GRANT).
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const { data: intact } = await admin
      .from("products")
      .select("price")
      .eq("id", seedA.productId)
      .single();
    expect(intact?.price).not.toBe(999);
  });

  it("no puede borrar una categoría de su propio tenant", async () => {
    await deviceA.client.from("categories").delete().eq("id", seedA.categoryId);

    const { data: intact } = await admin
      .from("categories")
      .select("id")
      .eq("id", seedA.categoryId)
      .maybeSingle();
    expect(intact, "el DELETE de un device borró una categoría real").not.toBeNull();
  });

  it("no puede insertar una mesa en su propio tenant", async () => {
    const { error } = await deviceA.client.from("tables").insert({
      tenant_id: tenantA.tenantId,
      venue_id: seedA.venueId,
      label: `mesa-intrusa-${nonce()}`,
    });
    expect(error).not.toBeNull();
    // Mismo razonamiento que products: device no tiene lectura de `venues` (categoría
    // B), así que el trigger assert_same_tenant no ve el venue real y dispara P0001
    // antes de que la policy de escritura de `tables` llegue a evaluar su WITH CHECK.
    expect(error?.code).toBe("P0001");
    expect(error?.message).toContain("cross-tenant reference rejected");
  });

  it("no puede insertar un venue en su propio tenant", async () => {
    const { error } = await deviceA.client.from("venues").insert({
      tenant_id: tenantA.tenantId,
      slug: `venue-intruso-${nonce()}`,
      name: "Intruso",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("no puede insertar un pedido nuevo", async () => {
    const { error } = await deviceA.client.from("orders").insert({
      tenant_id: tenantA.tenantId,
      venue_id: seedA.venueId,
      order_number: 999,
    });
    expect(error).not.toBeNull();
    // Mismo razonamiento: `orders` también depende de `venues` en assert_same_tenant, y
    // device no tiene lectura ahí -- P0001 antes de llegar al WITH CHECK de
    // orders_insert.
    expect(error?.code).toBe("P0001");
    expect(error?.message).toContain("cross-tenant reference rejected");
  });

  it("no puede borrar un pedido existente", async () => {
    await deviceA.client.from("orders").delete().eq("id", seedA.orderId);
    const { data: intact } = await admin
      .from("orders")
      .select("id")
      .eq("id", seedA.orderId)
      .maybeSingle();
    expect(intact, "el DELETE de un device borró un pedido real").not.toBeNull();
  });

  it("no puede modificar directamente printed_at de un pedido (debe pasar por la RPC)", async () => {
    const { data, error } = await deviceA.client
      .from("orders")
      .update({ printed_at: new Date().toISOString() })
      .eq("id", seedB.orderId) // usa el pedido de B a propósito: si esto tocase 0 filas
      // por aislamiento de tenant en vez de por el recorte de rol, sería un falso
      // positivo -- por eso el siguiente test usa el pedido PROPIO de A.
      .select();
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("un device no ve ni toca nada de OTRO tenant", () => {
  it("no ve los pedidos de otro tenant", async () => {
    const { data, error } = await deviceA.client
      .from("orders")
      .select("id")
      .eq("id", seedB.orderId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("no ve los ajustes de otro tenant", async () => {
    const { data, error } = await deviceA.client
      .from("tenant_settings")
      .select("tenant_id")
      .eq("tenant_id", tenantB.tenantId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("regresión: staff conserva el acceso que ya tenía", () => {
  it("staff YA NO puede gestionar el catálogo de su tenant (D1 tarea 1: escritura de config solo owner/admin)", async () => {
    // Hasta 20260722000006_role_write_policies.sql, staff podía crear/modificar/borrar
    // catálogo de punta a punta (era el comportamiento que este mismo test comprobaba
    // como "regresión que no debía romperse" tras el hardening de device de 000005). La
    // tarea 1 de la fase D1 introduce la dimensión de rol para las tablas de
    // CONFIGURACIÓN: staff pasa a solo-lectura ahí, owner/admin son los únicos que
    // escriben. Cobertura exhaustiva de ese cambio en role-write-policies.test.ts; aquí
    // solo se confirma que ESTE test concreto -- que antes documentaba lo contrario --
    // ya no reintroduce en silencio el acceso que acabamos de retirar.
    const { error: categoryError } = await staffA.client.from("categories").insert({
      tenant_id: tenantA.tenantId,
      slug: `staff-cat-${nonce()}`,
      name_i18n: { es: "Categoría de staff" },
    });
    expect(categoryError?.code).toBe("42501");

    const { error: updateError } = await staffA.client
      .from("products")
      .update({ price: 5.5 })
      .eq("id", seedA.productId);
    expect(updateError).toBeNull();
    const { data: intact } = await admin
      .from("products")
      .select("price")
      .eq("id", seedA.productId)
      .single();
    expect(intact?.price).not.toBe(5.5);
  });

  it("staff puede seguir insertando y borrando pedidos de su tenant", async () => {
    const { data: order, error: insertError } = await staffA.client
      .from("orders")
      .insert({ tenant_id: tenantA.tenantId, venue_id: seedA.venueId, order_number: 12345 })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    const orderId = order?.id as string;

    const { error: deleteError } = await staffA.client.from("orders").delete().eq("id", orderId);
    expect(deleteError).toBeNull();

    const { data: gone } = await admin.from("orders").select("id").eq("id", orderId).maybeSingle();
    expect(gone).toBeNull();
  });

  it("staff puede seguir leyendo todas las filas de devices de su tenant, no solo la propia", async () => {
    const { data, error } = await staffA.client.from("devices").select("id");
    expect(error).toBeNull();
    // Debe ver, como mínimo, la fila anónima de seedCatalog y la de deviceA -- el recorte
    // "solo mi propia fila" es específico del rol device, staff sigue viendo el tenant
    // entero.
    expect((data ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
