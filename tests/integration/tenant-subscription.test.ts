import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

/**
 * Las columnas que sostienen el corte por impago. Lo que se prueba aquí no es "existen":
 * es que sus valores por defecto y su CHECK sean los correctos, porque de ellos depende que
 * un cliente recién dado de alta se SIRVA (no se corte) y que nadie pueda escribir a mano un
 * estado que la política de `decidirEstado` no sabe interpretar.
 */
describe("columnas de suscripción", () => {
  it("un tenant nuevo nace en trialing, activo y sin ventana de gracia", async () => {
    const fixture = await createTenantFixture(`sub-${nonce()}`);
    try {
      const { data } = await admin
        .from("tenants")
        .select("plan_status, status, grace_until, stripe_subscription_id")
        .eq("id", fixture.tenantId)
        .single();

      expect(data?.plan_status).toBe("trialing");
      expect(data?.status, "un cliente nuevo se sirve, no se corta").toBe("active");
      expect(data?.grace_until).toBeNull();
      expect(data?.stripe_subscription_id).toBeNull();
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("rechaza un plan_status que no sea uno de los cuatro", async () => {
    const fixture = await createTenantFixture(`sub-malo-${nonce()}`);
    try {
      const { error } = await admin
        .from("tenants")
        .update({ plan_status: "inventado" })
        .eq("id", fixture.tenantId);
      expect(error, "el CHECK debía rechazar un estado desconocido").not.toBeNull();
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("no deja dos tenants con el mismo cliente de Stripe", async () => {
    // `applySubscriptionState` resuelve el tenant por esta columna con `.maybeSingle()`: dos
    // filas con el mismo customer harían que el webhook fallara con PGRST116 en vez de
    // aplicar el cobro. La unicidad es lo que hace correcto ese camino.
    const a = await createTenantFixture(`cus-a-${nonce()}`);
    const b = await createTenantFixture(`cus-b-${nonce()}`);
    const customerId = `cus_${nonce()}`;
    try {
      const { error: primero } = await admin
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", a.tenantId);
      expect(primero).toBeNull();

      const { error: segundo } = await admin
        .from("tenants")
        .update({ stripe_customer_id: customerId })
        .eq("id", b.tenantId);
      expect(segundo, "el índice único debía rechazar el duplicado").not.toBeNull();
    } finally {
      await deleteTenantFixture(a);
      await deleteTenantFixture(b);
    }
  });

  it("varios tenants pueden no tener cliente de Stripe a la vez", async () => {
    // El índice es PARCIAL a propósito: hoy casi todos los tenants tienen NULL, y un índice
    // único normal trataría esos NULL como distintos en Postgres, pero dejarlo explícito
    // aquí evita que alguien lo "simplifique" a un unique normal sin darse cuenta.
    const a = await createTenantFixture(`nulo-a-${nonce()}`);
    const b = await createTenantFixture(`nulo-b-${nonce()}`);
    try {
      const { data } = await admin
        .from("tenants")
        .select("id")
        .in("id", [a.tenantId, b.tenantId])
        .is("stripe_customer_id", null);
      expect(data).toHaveLength(2);
    } finally {
      await deleteTenantFixture(a);
      await deleteTenantFixture(b);
    }
  });
});
