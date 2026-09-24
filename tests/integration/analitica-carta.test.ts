import { analiticaDeCarta, registrarEscaneo } from "@suarex/db";
import { describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
} from "./helpers/tenants.js";

/**
 * ANALÍTICA DE CARTA.
 *
 * Las ventas ya dicen lo que SÍ se pidió. Lo que falta son las dos preguntas que no se pueden
 * responder con los pedidos solos: cuánta gente escanea y no llega a pedir, y qué platos no
 * pide NADIE -- los que ocupan sitio en la carta y no venden.
 */

/** Mesa activa del tenant, que es lo que la ruta del QR resuelve antes de contar. */
async function seedMesa(tenantId: string, venueId: string): Promise<string> {
  const { data } = await admin
    .from("tables")
    .insert({ tenant_id: tenantId, venue_id: venueId, label: `m-${nonce()}` })
    .select("id")
    .single();
  return data?.id as string;
}

describe("registrarEscaneo", () => {
  it("suma escaneos de la misma mesa en el mismo día", async () => {
    const f = await createTenantFixture(`esc-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "esc");
      const mesaId = await seedMesa(f.tenantId, seed.venueId);

      await registrarEscaneo(mesaId);
      await registrarEscaneo(mesaId);
      await registrarEscaneo(mesaId);

      const analitica = await analiticaDeCarta(f.tenantId, 30);
      expect(analitica.escaneos).toBe(3);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("una mesa desactivada no cuenta, y no es un error", async () => {
    // Quien escanea un QR retirado ve el mismo 404 de siempre; el contador no tiene por qué
    // enterarse, y desde luego la ruta no debe reventar por ello.
    const f = await createTenantFixture(`desa-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "desa");
      const mesaId = await seedMesa(f.tenantId, seed.venueId);
      await admin.from("tables").update({ is_active: false }).eq("id", mesaId);

      await expect(registrarEscaneo(mesaId)).resolves.toBeUndefined();
      expect((await analiticaDeCarta(f.tenantId, 30)).escaneos).toBe(0);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("una mesa inventada no cuenta ni lanza", async () => {
    const f = await createTenantFixture(`inv-${nonce()}`);
    try {
      await expect(
        registrarEscaneo("00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeUndefined();
      expect((await analiticaDeCarta(f.tenantId, 30)).escaneos).toBe(0);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("los escaneos de un tenant no se ven desde otro", async () => {
    const a = await createTenantFixture(`ta-${nonce()}`);
    const b = await createTenantFixture(`tb-${nonce()}`);
    try {
      const seedB = await seedCatalog(b.tenantId, "tb");
      await registrarEscaneo(await seedMesa(b.tenantId, seedB.venueId));

      expect((await analiticaDeCarta(a.tenantId, 30)).escaneos).toBe(0);
      expect((await analiticaDeCarta(b.tenantId, 30)).escaneos).toBe(1);
    } finally {
      await deleteTenantFixture(a);
      await deleteTenantFixture(b);
    }
  });
});

describe("analiticaDeCarta", () => {
  it("sin escaneos, la conversión es null y no cero", async () => {
    // Cero por cero no es 0 %. Enseñar "0 %" de conversión a un local que acaba de empezar es
    // decirle que su carta no funciona cuando lo que pasa es que nadie ha escaneado aún.
    const f = await createTenantFixture(`cero-${nonce()}`);
    try {
      const analitica = await analiticaDeCarta(f.tenantId, 30);
      expect(analitica.escaneos).toBe(0);
      expect(analitica.pedidos).toBe(0);
      expect(analitica.pedidosPorEscaneo).toBeNull();
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("cuenta los pedidos cobrados y calcula la proporción", async () => {
    const f = await createTenantFixture(`conv-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "conv");
      const mesaId = await seedMesa(f.tenantId, seed.venueId);
      for (let i = 0; i < 4; i++) await registrarEscaneo(mesaId);

      await admin.from("orders").insert({
        tenant_id: f.tenantId,
        venue_id: seed.venueId,
        table_id: mesaId,
        status: "paid",
        paid_at: new Date().toISOString(),
        total: 950,
        subtotal: 864,
        tax_amount: 86,
        order_number: 1,
      });

      const analitica = await analiticaDeCarta(f.tenantId, 30);
      expect(analitica.escaneos).toBe(4);
      expect(analitica.pedidos).toBe(1);
      expect(analitica.pedidosPorEscaneo).toBeCloseTo(0.25, 5);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("un pedido sin pagar no cuenta como conversión", async () => {
    // Un carrito abandonado es justo lo contrario de una conversión: contarlo daría por bueno
    // el caso que esta pantalla existe para detectar.
    const f = await createTenantFixture(`aban-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "aban");
      const mesaId = await seedMesa(f.tenantId, seed.venueId);
      await registrarEscaneo(mesaId);
      await admin.from("orders").insert({
        tenant_id: f.tenantId,
        venue_id: seed.venueId,
        table_id: mesaId,
        status: "pending",
        total: 950,
        subtotal: 864,
        tax_amount: 86,
        order_number: 2,
      });

      const analitica = await analiticaDeCarta(f.tenantId, 30);
      expect(analitica.pedidos).toBe(0);
      expect(analitica.pedidosPorEscaneo).toBe(0);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("lista los platos que no ha pedido nadie, con su categoría", async () => {
    const f = await createTenantFixture(`sinv-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "sinv");
      const mesaId = await seedMesa(f.tenantId, seed.venueId);

      await admin.from("products").insert({
        tenant_id: f.tenantId,
        category_id: seed.categoryId,
        name_i18n: { es: "Nadie me pide" },
        price: 12,
      });

      const { data: pedido } = await admin
        .from("orders")
        .insert({
          tenant_id: f.tenantId,
          venue_id: seed.venueId,
          table_id: mesaId,
          status: "served",
          paid_at: new Date().toISOString(),
          total: 950,
          subtotal: 864,
          tax_amount: 86,
          order_number: 3,
        })
        .select("id")
        .single();
      await admin.from("order_items").insert({
        tenant_id: f.tenantId,
        order_id: pedido?.id as string,
        product_id: seed.productId,
        name_snapshot: { es: "Prod sinv" },
        unit_price: 9.5,
        quantity: 1,
        line_total: 9.5,
        destination: "cocina",
      });

      const analitica = await analiticaDeCarta(f.tenantId, 30);
      const nombres = analitica.sinVender.map((p) => p.nombre);
      expect(nombres).toContain("Nadie me pide");
      expect(nombres, "el que sí se vendió no está en la lista").not.toContain("Prod sinv");
      expect(analitica.sinVender[0]?.categoria).toBe("Cat sinv");
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("un plato fuera de carta no es un plato que no se vende", async () => {
    // Retirado a propósito. Meterlo en la lista sería pedirle al dueño que revise una
    // decisión que ya tomó, y enterraría los que sí importan.
    const f = await createTenantFixture(`fuera-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "fuera");
      await admin.from("products").update({ is_available: false }).eq("id", seed.productId);

      const analitica = await analiticaDeCarta(f.tenantId, 30);
      expect(analitica.sinVender.map((p) => p.nombre)).not.toContain("Prod fuera");
    } finally {
      await deleteTenantFixture(f);
    }
  });
});
