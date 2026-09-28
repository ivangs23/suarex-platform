import { applySubscriptionState, suspendExpiredGrace } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

/**
 * La política de `decidirEstado` ya está probada sin red en `packages/db/src/billing.test.ts`.
 * Lo que se prueba AQUÍ es lo que aquella no puede: que el estado llegue de verdad a la fila,
 * que el tenant se localice por el identificador que Stripe conoce, y que el barrido solo
 * toque lo que debe.
 */

describe("applySubscriptionState", () => {
  it("un impago deja el servicio en pie y abre la ventana de gracia", async () => {
    const fixture = await createTenantFixture(`wh-${nonce()}`);
    const customerId = `cus_${nonce()}`;
    try {
      await admin
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", fixture.tenantId);

      expect(await applySubscriptionState(customerId, "past_due", "sub_1")).toBe("aplicado");

      const { data } = await admin
        .from("tenants")
        .select("status, plan_status, grace_until, stripe_subscription_id")
        .eq("id", fixture.tenantId)
        .single();

      expect(data?.status, "el impago NO corta en el momento").toBe("active");
      expect(data?.plan_status).toBe("past_due");
      expect(data?.grace_until).not.toBeNull();
      expect(data?.stripe_subscription_id).toBe("sub_1");
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("una baja corta de inmediato y cierra la ventana", async () => {
    const fixture = await createTenantFixture(`wh-baja-${nonce()}`);
    const customerId = `cus_${nonce()}`;
    try {
      await admin
        .from("tenants")
        .update({ stripe_customer_id: customerId, grace_until: new Date().toISOString() })
        .eq("id", fixture.tenantId);

      await applySubscriptionState(customerId, "canceled", "sub_2");

      const { data } = await admin
        .from("tenants")
        .select("status, grace_until")
        .eq("id", fixture.tenantId)
        .single();
      expect(data?.status).toBe("suspended");
      expect(data?.grace_until).toBeNull();
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("volver a estar al corriente reactiva y borra la ventana", async () => {
    const fixture = await createTenantFixture(`wh-ok-${nonce()}`);
    const customerId = `cus_${nonce()}`;
    try {
      await admin
        .from("tenants")
        .update({
          stripe_customer_id: customerId,
          status: "suspended",
          plan_status: "past_due",
          grace_until: new Date(Date.now() - 86400_000).toISOString(),
        })
        .eq("id", fixture.tenantId);

      await applySubscriptionState(customerId, "active", "sub_3");

      const { data } = await admin
        .from("tenants")
        .select("status, plan_status, grace_until")
        .eq("id", fixture.tenantId)
        .single();
      expect(data?.status).toBe("active");
      expect(data?.plan_status).toBe("active");
      expect(data?.grace_until, "arrastrar la ventana volvería a suspenderlo al barrer").toBeNull();
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("distingue un cliente de Stripe sin tenant asociado", async () => {
    // No es benigno: significa que se está cobrando una suscripción de la que este sistema no
    // tiene registro, o que el webhook apunta al entorno equivocado.
    expect(await applySubscriptionState(`cus_fantasma_${nonce()}`, "active", null)).toBe(
      "tenant-no-encontrado",
    );
  });
});

describe("suspendExpiredGrace", () => {
  it("suspende al de gracia vencida y no toca al que aún está dentro", async () => {
    const vencido = await createTenantFixture(`gracia-fuera-${nonce()}`);
    const dentro = await createTenantFixture(`gracia-dentro-${nonce()}`);
    try {
      await admin
        .from("tenants")
        .update({
          plan_status: "past_due",
          grace_until: new Date(Date.now() - 86400_000).toISOString(),
        })
        .eq("id", vencido.tenantId);
      await admin
        .from("tenants")
        .update({
          plan_status: "past_due",
          grace_until: new Date(Date.now() + 86400_000).toISOString(),
        })
        .eq("id", dentro.tenantId);

      await suspendExpiredGrace();

      const { data: a } = await admin
        .from("tenants")
        .select("status")
        .eq("id", vencido.tenantId)
        .single();
      const { data: b } = await admin
        .from("tenants")
        .select("status")
        .eq("id", dentro.tenantId)
        .single();

      expect(a?.status).toBe("suspended");
      expect(b?.status, "un tenant todavía en gracia NO se puede cortar").toBe("active");
    } finally {
      await deleteTenantFixture(vencido);
      await deleteTenantFixture(dentro);
    }
  });

  it("no toca a un tenant sin ventana abierta", async () => {
    // `grace_until` NULL no puede barrerse: son la inmensa mayoría de los clientes sanos.
    const sano = await createTenantFixture(`sano-${nonce()}`);
    try {
      await suspendExpiredGrace();
      const { data } = await admin
        .from("tenants")
        .select("status")
        .eq("id", sano.tenantId)
        .single();
      expect(data?.status).toBe("active");
    } finally {
      await deleteTenantFixture(sano);
    }
  });
});
