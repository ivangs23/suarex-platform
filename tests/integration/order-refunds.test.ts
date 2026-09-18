import { listActiveOrders, markOrderDisputed, markOrderRefunded } from "@suarex/db";
import { describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
} from "./helpers/tenants.js";

/**
 * EL DINERO DEVUELTO TIENE QUE LLEGAR A LA BASE.
 *
 * Hasta ahora no llegaba: el webhook solo escuchaba `payment_intent.succeeded`, así que un
 * reembolso hecho en Stripe dejaba el pedido `paid` para siempre. Cuadrar la caja exigía mirar
 * Stripe a mano.
 */

async function pedidoPagado(tenantId: string, label: string, paymentIntentId: string) {
  const seed = await seedCatalog(tenantId, label);
  await admin
    .from("orders")
    .update({ status: "paid", stripe_payment_intent_id: paymentIntentId, total: 24.0 })
    .eq("id", seed.orderId);
  return seed.orderId;
}

describe("markOrderRefunded", () => {
  it("marca el pedido como reembolsado con su importe y su fecha", async () => {
    const fixture = await createTenantFixture(`reemb-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "reemb", pi);

      expect(await markOrderRefunded(pi, 2400)).toBe("marcado");

      const { data } = await admin
        .from("orders")
        .select("status, refunded_cents, refunded_at")
        .eq("id", orderId)
        .single();
      expect(data?.status).toBe("refunded");
      expect(data?.refunded_cents).toBe(2400);
      expect(data?.refunded_at).not.toBeNull();
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("registra un reembolso PARCIAL sin inventarse el total", async () => {
    // Stripe permite devolver parte. Derivar el importe de `total` daría un número falso en
    // la conciliación.
    const fixture = await createTenantFixture(`parcial-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "parcial", pi);
      await markOrderRefunded(pi, 500);

      const { data } = await admin
        .from("orders")
        .select("refunded_cents")
        .eq("id", orderId)
        .single();
      expect(data?.refunded_cents).toBe(500);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("es idempotente: Stripe reintenta el mismo evento", async () => {
    const fixture = await createTenantFixture(`idem-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "idem", pi);
      await markOrderRefunded(pi, 2400);
      const primera = (await admin.from("orders").select("refunded_at").eq("id", orderId).single())
        .data?.refunded_at;

      expect(await markOrderRefunded(pi, 2400)).toBe("ya-reembolsado");

      const segunda = (await admin.from("orders").select("refunded_at").eq("id", orderId).single())
        .data?.refunded_at;
      expect(segunda, "un reintento no puede mover la fecha").toBe(primera);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("distingue un PaymentIntent sin pedido asociado", async () => {
    // No es benigno: se devolvió dinero de algo de lo que este sistema no tiene registro.
    expect(await markOrderRefunded(`pi_fantasma_${nonce()}`, 100)).toBe("order-not-found");
  });
});

describe("markOrderDisputed", () => {
  it("marca la disputa SIN cambiar el estado del pedido", async () => {
    // Una disputa no es un reembolso: el banco todavía no ha decidido y el pedido puede acabar
    // cobrado. Marcarlo `refunded` aquí haría que la caja cuadrara mal en la otra dirección.
    const fixture = await createTenantFixture(`disp-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "disp", pi);

      expect(await markOrderDisputed(pi)).toBe("marcado");

      const { data } = await admin
        .from("orders")
        .select("status, disputed_at, refunded_at")
        .eq("id", orderId)
        .single();
      expect(data?.status, "sigue pagado hasta que el banco decida").toBe("paid");
      expect(data?.disputed_at).not.toBeNull();
      expect(data?.refunded_at).toBeNull();
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});

describe("un pedido reembolsado sale del tablero", () => {
  it("listActiveOrders no lo devuelve", async () => {
    // Si al comensal se le devolvió el dinero, la cocina tiene que dejar de prepararlo.
    const fixture = await createTenantFixture(`tablero-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "tablero", pi);

      const antes = await listActiveOrders(fixture.tenantId);
      expect(
        antes.some((o) => o.id === orderId),
        "pagado: sí está en el tablero",
      ).toBe(true);

      await markOrderRefunded(pi, 2400);

      const despues = await listActiveOrders(fixture.tenantId);
      expect(
        despues.some((o) => o.id === orderId),
        "reembolsado: ya no",
      ).toBe(false);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});
