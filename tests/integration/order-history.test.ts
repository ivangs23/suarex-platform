import { listOrderHistory } from "@suarex/db";
import { describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
} from "./helpers/tenants.js";

/**
 * HISTÓRICO DE PEDIDOS DEL PANEL.
 *
 * El tablero de `/staff` solo enseña lo ACTIVO (`listActiveOrders` filtra servidos, cancelados
 * y reembolsados): en cuanto una comanda se sirve, desaparece y no hay forma de volver a
 * verla. Esto es lo que contesta "¿qué pidió la mesa 4 anoche?" y "¿este cobro de 38 € de qué
 * era?".
 */

const haceHoras = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

async function pedido(
  tenantId: string,
  seedOrderId: string,
  campos: Record<string, unknown>,
): Promise<string> {
  const { data } = await admin
    .from("orders")
    .select("venue_id, table_id")
    .eq("id", seedOrderId)
    .single();
  const { data: nuevo, error } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      venue_id: data?.venue_id,
      table_id: data?.table_id,
      order_number: Math.floor(Math.random() * 100000),
      subtotal: 20,
      tax_amount: 2,
      total: 22,
      ...campos,
    })
    .select("id")
    .single();
  if (error) throw error;
  return nuevo.id as string;
}

describe("listOrderHistory", () => {
  it("devuelve los pedidos del más reciente al más antiguo", async () => {
    // El hostelero busca lo de anoche, no lo del mes pasado: lo último va primero.
    const f = await createTenantFixture(`hist-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "hist");
      const viejo = await pedido(f.tenantId, seed.orderId, {
        status: "served",
        created_at: haceHoras(48),
      });
      const nuevo = await pedido(f.tenantId, seed.orderId, {
        status: "served",
        created_at: haceHoras(1),
      });

      const filas = await listOrderHistory(f.tenantId);
      const ids = filas.map((p) => p.id);
      expect(ids.indexOf(nuevo)).toBeLessThan(ids.indexOf(viejo));
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("incluye los servidos, cancelados y reembolsados que el tablero oculta", async () => {
    // Justamente los que `listActiveOrders` filtra: si el histórico los ocultara también, no
    // habría ningún sitio donde volver a verlos.
    const f = await createTenantFixture(`todos-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "todos");
      for (const status of ["served", "cancelled", "refunded", "paid"]) {
        await pedido(f.tenantId, seed.orderId, { status });
      }

      const estados = (await listOrderHistory(f.tenantId)).map((p) => p.status);
      for (const status of ["served", "cancelled", "refunded", "paid"]) {
        expect(estados, `falta ${status}`).toContain(status);
      }
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("no mezcla pedidos de otro restaurante", async () => {
    const a = await createTenantFixture(`ha-${nonce()}`);
    const b = await createTenantFixture(`hb-${nonce()}`);
    try {
      const seedA = await seedCatalog(a.tenantId, "a");
      const seedB = await seedCatalog(b.tenantId, "b");
      const mio = await pedido(a.tenantId, seedA.orderId, { status: "served" });
      const ajeno = await pedido(b.tenantId, seedB.orderId, { status: "served" });

      const ids = (await listOrderHistory(a.tenantId)).map((p) => p.id);
      expect(ids).toContain(mio);
      expect(ids).not.toContain(ajeno);
    } finally {
      await deleteTenantFixture(a);
      await deleteTenantFixture(b);
    }
  });

  it("trae el detalle de las líneas, que es para lo que se consulta", async () => {
    // "¿Este cobro de 38 € de qué era?" no se responde con un total: hace falta ver qué se
    // pidió. Del snapshot congelado, no del catálogo de hoy.
    const f = await createTenantFixture(`det-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "det");
      const orderId = await pedido(f.tenantId, seed.orderId, { status: "served" });
      await admin.from("order_items").insert({
        tenant_id: f.tenantId,
        order_id: orderId,
        product_id: seed.productId,
        name_snapshot: { es: "Pulpo a la gallega" },
        unit_price: 18,
        quantity: 2,
        line_total: 36,
        destination: "cocina",
      });

      const fila = (await listOrderHistory(f.tenantId)).find((p) => p.id === orderId);
      expect(fila?.lineas[0]?.nombre).toBe("Pulpo a la gallega");
      expect(fila?.lineas[0]?.cantidad).toBe(2);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("marca lo reembolsado, para que un total no engañe", async () => {
    const f = await createTenantFixture(`rmb-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "rmb");
      const orderId = await pedido(f.tenantId, seed.orderId, {
        status: "refunded",
        total: 22,
        refunded_cents: 2200,
      });

      const fila = (await listOrderHistory(f.tenantId)).find((p) => p.id === orderId);
      expect(fila?.refundedCents).toBe(2200);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("acota el número de filas: un restaurante con un año de pedidos no puede traerlos todos", async () => {
    const f = await createTenantFixture(`lim-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "lim");
      for (let i = 0; i < 5; i++) await pedido(f.tenantId, seed.orderId, { status: "served" });

      expect(await listOrderHistory(f.tenantId, { limite: 3 })).toHaveLength(3);
    } finally {
      await deleteTenantFixture(f);
    }
  });
});
