import { ventasDelDia } from "@suarex/db";
import { describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
} from "./helpers/tenants.js";

/**
 * INFORME DE VENTAS DEL DÍA.
 *
 * Lo que el hostelero pregunta el día 2: "¿cuánto he vendido hoy y de qué?". Solo lectura, sin
 * arqueo ni cierre de turno (decisión D1 del spec).
 *
 * Lo que más se prueba aquí es qué pedidos CUENTAN. Contar de más o de menos en un informe de
 * ventas es peor que no tenerlo: el hostelero toma decisiones con ese número.
 */

const HOY = () => new Date().toISOString();
const haceHoras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/** Crea un pedido con estado, importe y fecha concretos. */
async function pedido(
  tenantId: string,
  seedOrderId: string,
  campos: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin
    .from("orders")
    .select("venue_id, table_id")
    .eq("id", seedOrderId)
    .single();
  if (error) throw error;
  const { data: nuevo, error: e2 } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      venue_id: data.venue_id,
      table_id: data.table_id,
      order_number: Math.floor(Math.random() * 100000),
      subtotal: 20,
      tax_amount: 2,
      total: 22,
      ...campos,
    })
    .select("id")
    .single();
  if (e2) throw e2;
  return nuevo.id as string;
}

describe("ventasDelDia", () => {
  it("suma los pedidos pagados de hoy y NO los pendientes", async () => {
    // Un pedido `pending` es alguien que abrió el carrito y no pagó. Contarlo como venta
    // inflaría la caja con dinero que nunca entró.
    const f = await createTenantFixture(`vent-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "vent");
      await pedido(f.tenantId, seed.orderId, { status: "paid", paid_at: HOY(), total: 30 });
      await pedido(f.tenantId, seed.orderId, { status: "pending", total: 99 });

      const r = await ventasDelDia(f.tenantId);
      expect(r.totalCents).toBe(3000);
      expect(r.numPedidos).toBe(1);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("cuenta también los servidos: un pedido servido SE COBRÓ", async () => {
    // `served` y `preparing` vienen DESPUÉS de pagar (ver el flujo del webhook). Filtrar solo
    // por `paid` dejaría fuera casi toda la venta del día, que es el error obvio aquí.
    const f = await createTenantFixture(`serv-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "serv");
      await pedido(f.tenantId, seed.orderId, { status: "served", paid_at: HOY(), total: 10 });
      await pedido(f.tenantId, seed.orderId, { status: "preparing", paid_at: HOY(), total: 15 });

      const r = await ventasDelDia(f.tenantId);
      expect(r.totalCents).toBe(2500);
      expect(r.numPedidos).toBe(2);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("DESCUENTA lo reembolsado en vez de ignorarlo", async () => {
    // Un informe que ignora los reembolsos dice que se vendió más de lo que entró en caja. El
    // hostelero cuadraría contra el banco y no le saldría.
    const f = await createTenantFixture(`reem-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "reem");
      await pedido(f.tenantId, seed.orderId, {
        status: "served",
        paid_at: HOY(),
        total: 50,
        refunded_cents: 1500,
      });

      const r = await ventasDelDia(f.tenantId);
      expect(r.totalCents, "50 EUR cobrados menos 15 devueltos").toBe(3500);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("no cuenta los pedidos de ayer", async () => {
    const f = await createTenantFixture(`ayer-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "ayer");
      await pedido(f.tenantId, seed.orderId, {
        status: "served",
        paid_at: haceHoras(30),
        total: 99,
      });
      await pedido(f.tenantId, seed.orderId, { status: "served", paid_at: HOY(), total: 10 });

      const r = await ventasDelDia(f.tenantId);
      expect(r.totalCents).toBe(1000);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("no cuenta los pedidos de OTRO restaurante", async () => {
    // Un informe que cruce tenants sería una fuga de datos de negocio entre clientes.
    const a = await createTenantFixture(`iso-a-${nonce()}`);
    const b = await createTenantFixture(`iso-b-${nonce()}`);
    try {
      const seedA = await seedCatalog(a.tenantId, "a");
      const seedB = await seedCatalog(b.tenantId, "b");
      await pedido(a.tenantId, seedA.orderId, { status: "served", paid_at: HOY(), total: 10 });
      await pedido(b.tenantId, seedB.orderId, { status: "served", paid_at: HOY(), total: 999 });

      const r = await ventasDelDia(a.tenantId);
      expect(r.totalCents).toBe(1000);
    } finally {
      await deleteTenantFixture(a);
      await deleteTenantFixture(b);
    }
  });

  it("desglosa por producto, de más vendido a menos", async () => {
    const f = await createTenantFixture(`prod-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "prod");
      const orderId = await pedido(f.tenantId, seed.orderId, {
        status: "served",
        paid_at: HOY(),
        total: 30,
      });
      await admin.from("order_items").insert([
        {
          tenant_id: f.tenantId,
          order_id: orderId,
          product_id: seed.productId,
          name_snapshot: { es: "Croquetas" },
          unit_price: 5,
          quantity: 3,
          line_total: 15,
          destination: "cocina",
        },
        {
          tenant_id: f.tenantId,
          order_id: orderId,
          product_id: seed.productId,
          name_snapshot: { es: "Café" },
          unit_price: 1.5,
          quantity: 1,
          line_total: 1.5,
          destination: "barra",
        },
      ]);

      const r = await ventasDelDia(f.tenantId);
      expect(r.porProducto[0]?.nombre).toBe("Croquetas");
      expect(r.porProducto[0]?.unidades).toBe(3);
      expect(r.porProducto[1]?.nombre).toBe("Café");
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("un día sin ventas devuelve ceros, no revienta", async () => {
    const f = await createTenantFixture(`vacio-${nonce()}`);
    try {
      const r = await ventasDelDia(f.tenantId);
      expect(r.totalCents).toBe(0);
      expect(r.numPedidos).toBe(0);
      expect(r.porProducto).toEqual([]);
    } finally {
      await deleteTenantFixture(f);
    }
  });
});
