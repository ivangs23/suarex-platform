import { getOrderReceipt } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
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
});
