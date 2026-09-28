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

describe("reembolsos parciales acumulados", () => {
  it("un segundo reembolso parcial ACTUALIZA el acumulado", async () => {
    // El fallo que esto fija: la guarda anterior (`refunded_at is null`) descartaba el
    // segundo evento, así que devolver 5 € y luego 10 € más dejaba la base diciendo 5 €.
    // Stripe manda el ACUMULADO en `charge.refunded`, por eso se escucha ese evento.
    const fixture = await createTenantFixture(`acum-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "acum", pi);

      await markOrderRefunded(pi, 500);
      await markOrderRefunded(pi, 1500);

      const { data } = await admin
        .from("orders")
        .select("refunded_cents, status")
        .eq("id", orderId)
        .single();
      expect(data?.refunded_cents, "debe reflejar el acumulado, no el primero").toBe(1500);
      // 1500 de 2400: sigue siendo parcial.
      expect(data?.status).toBe("paid");
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("un reembolso PARCIAL no marca el pedido como reembolsado ni lo saca del tablero", async () => {
    // Devolver un plato de cuatro no puede hacer que la cocina deje de preparar los otros
    // tres, ni pisar `preparing`/`served`, que se perdería sin vuelta atrás.
    const fixture = await createTenantFixture(`parcial2-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "parcial2", pi);
      await admin.from("orders").update({ status: "preparing" }).eq("id", orderId);

      await markOrderRefunded(pi, 600);

      const { data } = await admin
        .from("orders")
        .select("status, refunded_cents")
        .eq("id", orderId)
        .single();
      expect(data?.status, "un parcial no pisa el estado de servicio").toBe("preparing");
      expect(data?.refunded_cents).toBe(600);

      const activos = await listActiveOrders(fixture.tenantId);
      expect(
        activos.some((o) => o.id === orderId),
        "sigue en el tablero",
      ).toBe(true);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("el reembolso TOTAL sí marca refunded y saca del tablero", async () => {
    const fixture = await createTenantFixture(`total-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "total", pi);
      await markOrderRefunded(pi, 2400);

      const { data } = await admin.from("orders").select("status").eq("id", orderId).single();
      expect(data?.status).toBe("refunded");

      const activos = await listActiveOrders(fixture.tenantId);
      expect(activos.some((o) => o.id === orderId)).toBe(false);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("la fecha del primer reembolso no se mueve con los siguientes", async () => {
    const fixture = await createTenantFixture(`fecha-${nonce()}`);
    const pi = `pi_${nonce()}`;
    try {
      const orderId = await pedidoPagado(fixture.tenantId, "fecha", pi);
      await markOrderRefunded(pi, 500);
      const primera = (await admin.from("orders").select("refunded_at").eq("id", orderId).single())
        .data?.refunded_at;

      await markOrderRefunded(pi, 900);
      const segunda = (await admin.from("orders").select("refunded_at").eq("id", orderId).single())
        .data?.refunded_at;

      expect(segunda, "marca cuándo EMPEZÓ a devolverse, no el último tramo").toBe(primera);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});
