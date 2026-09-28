import { createPendingOrder, getOrderReceipt } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * El recibo tiene que reflejar lo que se pidió Y SE PAGÓ, no el catálogo de hoy: si un precio
 * cambia o un plato desaparece después, el recibo del comensal debe seguir intacto. Por eso
 * sale de los SNAPSHOTS congelados en la compra, y eso es justo lo que se comprueba aquí.
 */
let tenant: TenantFixture;
let venueId: string;

afterAll(async () => {
  if (tenant) await deleteTenantFixture(tenant);
});

beforeAll(async () => {
  tenant = await createTenantFixture(`receipt-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
});

async function crearPedidoConLineas(token: string): Promise<void> {
  const { data: o } = await admin
    .from("orders")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      order_number: 900,
      status: "paid",
      total: 24,
      currency: "EUR",
      public_token: token,
    })
    .select("id")
    .single();
  const orderId = o?.id as string;

  const { data: items } = await admin
    .from("order_items")
    .insert([
      {
        tenant_id: tenant.tenantId,
        order_id: orderId,
        name_snapshot: { es: "Café con leche", pt: "Galão" },
        unit_price: 1.6,
        quantity: 2,
        line_total: 3.6,
        destination: "barra",
        notes: "sin azúcar",
      },
    ])
    .select("id");
  await admin.from("order_item_extras").insert({
    tenant_id: tenant.tenantId,
    order_item_id: items?.[0]?.id as string,
    name_snapshot: { es: "Leche de avena" },
    price: 0.2,
  });
}

describe("getOrderReceipt", () => {
  it("desglosa el pedido desde los snapshots: líneas, extras, nota y total", async () => {
    const token = crypto.randomUUID();
    await crearPedidoConLineas(token);

    const receipt = await getOrderReceipt(token, "es");
    expect(receipt).not.toBeNull();
    expect(receipt?.orderNumber).toBe(900);
    expect(receipt?.totalCents).toBe(2400);
    expect(receipt?.lines).toHaveLength(1);

    const linea = receipt?.lines[0];
    expect(linea?.name).toBe("Café con leche");
    expect(linea?.quantity).toBe(2);
    expect(linea?.lineTotalCents).toBe(360);
    expect(linea?.notes).toBe("sin azúcar");
    expect(linea?.extras).toEqual([{ name: "Leche de avena", priceCents: 20 }]);
  });

  it("resuelve los nombres al idioma pedido, con es de respaldo", async () => {
    const token = crypto.randomUUID();
    await crearPedidoConLineas(token);

    // El producto tiene pt ("Galão"); el extra no, así que cae al es.
    const receipt = await getOrderReceipt(token, "pt");
    expect(receipt?.lines[0]?.name).toBe("Galão");
    expect(receipt?.lines[0]?.extras[0]?.name).toBe("Leche de avena");
  });

  it("un token inexistente devuelve null, no rompe la página del recibo", async () => {
    expect(await getOrderReceipt(crypto.randomUUID())).toBeNull();
  });
  it("devuelve base imponible e IVA, no solo el total", async () => {
    // Fixture PROPIA, no la de módulo: `seedCatalog` siembra un tenant desde cero -- sede por
    // defecto incluida -- y aplicarlo sobre `tenant`, que ya tiene la suya, choca con
    // venues_single_default_per_tenant. El try/finally la borra pase lo que pase: con
    // retry: 2, un fallo a medias dejaría tenants huérfanos y el reintento chocaría contra
    // las claves que dejó el intento anterior.
    const propio = await createTenantFixture(`recibo-iva-${nonce()}`);
    try {
      const seed = await seedCatalog(propio.tenantId, "iva");
      // `createPendingOrder` exige `tableId: string` y `SeedResult` no expone mesa.
      const { data: mesa } = await admin
        .from("tables")
        .insert({ tenant_id: propio.tenantId, venue_id: seed.venueId, label: "iva-pedido" })
        .select("id")
        .single();

      const { publicToken } = await createPendingOrder({
        tenantId: propio.tenantId,
        venueId: seed.venueId,
        tableId: mesa?.id as string,
        lines: [{ productId: seed.productId, quantity: 2, extraIds: [], notes: null }],
        taxRate: 0.1,
      });

      const receipt = await getOrderReceipt(publicToken);
      // Lanzar en vez de `!`: estrecha el tipo para las aserciones de abajo y, si algún día
      // esto devuelve null para un pedido recién creado, el fallo lo dice en una línea.
      if (!receipt) throw new Error("getOrderReceipt devolvió null para un pedido recién creado");

      // base + IVA tiene que cuadrar con el total al céntimo: si no cuadra, el desglose que
      // se enseña al comensal estaría mintiendo.
      expect(receipt.subtotalCents + receipt.taxCents).toBe(receipt.totalCents);
      expect(receipt.taxCents).toBeGreaterThan(0);
    } finally {
      await deleteTenantFixture(propio);
    }
  });
});
