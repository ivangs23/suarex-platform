import {
  createTenantWithOwner,
  listPlatformTenants,
  setTenantStatus,
  setTenantStripeCustomer,
  suspendExpiredGrace,
} from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

/**
 * EL ALTA DE CLIENTE DESDE LA CONSOLA, que sustituye a `scripts/create-tenant.mjs`.
 *
 * Lo que más se prueba aquí no es el camino feliz, es el REINTENTO: un alta que falla a mitad
 * (Stripe no responde, se corta la conexión) tiene que poder repetirse sin duplicar nada y,
 * sobre todo, SIN pisar lo que el dueño ya haya configurado.
 */

async function limpiar(tenantId: string, ownerUserId?: string) {
  if (ownerUserId) await admin.auth.admin.deleteUser(ownerUserId).catch(() => {});
  await admin.from("tenants").delete().eq("id", tenantId);
}

describe("createTenantWithOwner", () => {
  it("da de alta un cliente completo: tenant, sede por defecto, ajustes y owner", async () => {
    const slug = `alta-${nonce()}`;
    const email = `dueno-${nonce()}@suarex.local`;
    const { tenantId, ownerUserId } = await createTenantWithOwner({
      slug,
      name: "Bar de Prueba",
      ownerEmail: email,
      theme: "generic",
      locale: "es",
      currency: "EUR",
      redirectTo: `http://${slug}.localhost:3000/staff/nueva-clave`,
    });

    try {
      const { data: venue } = await admin
        .from("venues")
        .select("is_default")
        .eq("tenant_id", tenantId)
        .single();
      // Sin sede por defecto no se puede crear NINGÚN pedido (`createPendingOrder` la exige):
      // el cliente tendría una carta que no deja pedir.
      expect(venue?.is_default).toBe(true);

      const { data: settings } = await admin
        .from("tenant_settings")
        .select("theme, locale, branding")
        .eq("tenant_id", tenantId)
        .single();
      expect(settings?.theme).toBe("generic");
      // `branding.name` NO es decorativo: la carta y el recibo pintan
      // `parseBranding(branding).name ?? tenant.slug`. Con `{}` el cliente enseñaría
      // "alta-xxxx" en vez de "Bar de Prueba" hasta que alguien entrara en ajustes.
      expect((settings?.branding as { name?: string })?.name).toBe("Bar de Prueba");

      const { data: membership } = await admin
        .from("memberships")
        .select("role")
        .eq("user_id", ownerUserId)
        .eq("tenant_id", tenantId)
        .single();
      expect(membership?.role).toBe("owner");
    } finally {
      await limpiar(tenantId, ownerUserId);
    }
  });

  it("un reintento NO pisa lo que el dueño ya configuró", async () => {
    // La prueba que justifica leer-entonces-crear en vez de upsert. Un upsert sobre todas las
    // columnas del payload reescribiría `branding` y `fiscal` a los valores del formulario y
    // borraría lo que el dueño hubiera editado en /admin/ajustes.
    const slug = `idem-${nonce()}`;
    const email = `dueno-${nonce()}@suarex.local`;
    const entrada = {
      slug,
      name: "Bar Idempotente",
      ownerEmail: email,
      theme: "generic",
      locale: "es",
      currency: "EUR",
      redirectTo: `http://${slug}.localhost:3000/staff/nueva-clave`,
    };

    const primero = await createTenantWithOwner(entrada);
    try {
      // El dueño entra en su panel y configura lo suyo.
      await admin
        .from("tenant_settings")
        .update({
          branding: { name: "El Nombre Que Yo Quiero", colors: { primary: "#ff0000" } },
          fiscal: { legalName: "Mi Empresa SL", cif: "B99999999" },
        })
        .eq("tenant_id", primero.tenantId);

      // Y alguien reejecuta el alta.
      const segundo = await createTenantWithOwner(entrada);
      expect(segundo.tenantId, "no puede crear un tenant nuevo con el mismo slug").toBe(
        primero.tenantId,
      );

      const { data } = await admin
        .from("tenant_settings")
        .select("branding, fiscal")
        .eq("tenant_id", primero.tenantId)
        .single();
      expect((data?.branding as { name?: string })?.name).toBe("El Nombre Que Yo Quiero");
      expect((data?.fiscal as { cif?: string })?.cif).toBe("B99999999");

      // Y tampoco duplica la sede.
      const { data: sedes } = await admin
        .from("venues")
        .select("id")
        .eq("tenant_id", primero.tenantId);
      expect(sedes ?? []).toHaveLength(1);
    } finally {
      await limpiar(primero.tenantId, primero.ownerUserId);
    }
  });

  it("reutiliza la cuenta si el dueño ya es cliente de otro local", async () => {
    // Caso real: el mismo dueño abre un segundo restaurante. `inviteUserByEmail` falla porque
    // la cuenta existe, y hay que recuperarla en vez de abortar el alta a medias.
    const email = `repetido-${nonce()}@suarex.local`;
    const a = await createTenantWithOwner({
      slug: `local-a-${nonce()}`,
      name: "Local A",
      ownerEmail: email,
      theme: "generic",
      locale: "es",
      currency: "EUR",
      redirectTo: "http://x.localhost:3000/staff/nueva-clave",
    });
    const b = await createTenantWithOwner({
      slug: `local-b-${nonce()}`,
      name: "Local B",
      ownerEmail: email,
      theme: "generic",
      locale: "es",
      currency: "EUR",
      redirectTo: "http://y.localhost:3000/staff/nueva-clave",
    });

    try {
      expect(b.ownerUserId, "misma persona, misma cuenta").toBe(a.ownerUserId);
      const { data } = await admin
        .from("memberships")
        .select("tenant_id")
        .eq("user_id", a.ownerUserId);
      expect(data ?? [], "una membership por local").toHaveLength(2);
    } finally {
      await limpiar(a.tenantId);
      await limpiar(b.tenantId, a.ownerUserId);
    }
  });
});

describe("listPlatformTenants", () => {
  it("lista TODOS los tenants, no los de uno", async () => {
    // Es la única consulta del sistema que barre entre clientes a propósito.
    const filas = await listPlatformTenants();
    const slugs = filas.map((f) => f.slug);
    expect(slugs).toContain("garum");
    expect(slugs).toContain("manuela");
  });

  it("trae el estado de facturación que la consola necesita pintar", async () => {
    const fixture = await createTenantFixture(`lista-${nonce()}`);
    try {
      const fila = (await listPlatformTenants()).find((f) => f.id === fixture.tenantId);
      expect(fila?.status).toBe("active");
      expect(fila?.planStatus).toBe("trialing");
      expect(fila?.plan).toBe("free");
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});

describe("setTenantStatus", () => {
  it("suspende y reactiva", async () => {
    // NUNCA sobre `garum`: es el tenant del que cuelga TODA la suite e2e (playwright.config.ts
    // lo usa como baseURL y como URL de readiness del webServer). Si este test abortara entre
    // el suspend y el reactivate, el proxy pasaría a responder 503 para ese host y la suite
    // entera caería apuntando a otro sitio -- y con retry: 2 el reintento arrancaría ya
    // suspendido. Fixture propia y try/finally.
    const fixture = await createTenantFixture(`estado-${nonce()}`);
    try {
      await setTenantStatus(fixture.tenantId, "suspended");
      const { data: a } = await admin
        .from("tenants")
        .select("status")
        .eq("id", fixture.tenantId)
        .single();
      expect(a?.status).toBe("suspended");

      await setTenantStatus(fixture.tenantId, "active");
      const { data: b } = await admin
        .from("tenants")
        .select("status")
        .eq("id", fixture.tenantId)
        .single();
      expect(b?.status).toBe("active");
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});

describe("setTenantStripeCustomer", () => {
  it("engancha el cliente de Stripe al tenant", async () => {
    const fixture = await createTenantFixture(`stripe-${nonce()}`);
    const customerId = `cus_${nonce()}`;
    try {
      await setTenantStripeCustomer(fixture.tenantId, customerId);
      const { data } = await admin
        .from("tenants")
        .select("stripe_customer_id")
        .eq("id", fixture.tenantId)
        .single();
      expect(data?.stripe_customer_id).toBe(customerId);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});

describe("setTenantStatus — reactivar", () => {
  it("reactivar LIMPIA la ventana de gracia", async () => {
    // Sin esto, un tenant suspendido por gracia vencida que se reactiva desde la consola
    // conserva `grace_until` en el pasado y `suspendExpiredGrace` lo vuelve a suspender esa
    // misma noche: el cliente paga por transferencia, lo reactivas, y el restaurante abre al
    // día siguiente sin carta.
    const fixture = await createTenantFixture(`reactivar-${nonce()}`);
    try {
      await admin
        .from("tenants")
        .update({
          status: "suspended",
          plan_status: "past_due",
          grace_until: new Date(Date.now() - 86400_000).toISOString(),
        })
        .eq("id", fixture.tenantId);

      await setTenantStatus(fixture.tenantId, "active");

      const { data } = await admin
        .from("tenants")
        .select("status, grace_until")
        .eq("id", fixture.tenantId)
        .single();
      expect(data?.status).toBe("active");
      expect(data?.grace_until, "arrastrarla lo volvería a suspender esta noche").toBeNull();

      // Y el barrido, de hecho, ya no lo toca.
      await suspendExpiredGrace();
      const { data: tras } = await admin
        .from("tenants")
        .select("status")
        .eq("id", fixture.tenantId)
        .single();
      expect(tras?.status, "el cron ya no puede deshacer la reactivación").toBe("active");
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("suspender NO toca la ventana de gracia", async () => {
    // Solo la reactivación la limpia: suspender a mano no debe borrar el rastro de por qué.
    const fixture = await createTenantFixture(`suspender-${nonce()}`);
    const hasta = new Date(Date.now() + 86400_000).toISOString();
    try {
      await admin.from("tenants").update({ grace_until: hasta }).eq("id", fixture.tenantId);
      await setTenantStatus(fixture.tenantId, "suspended");

      const { data } = await admin
        .from("tenants")
        .select("grace_until")
        .eq("id", fixture.tenantId)
        .single();
      expect(data?.grace_until).not.toBeNull();
    } finally {
      await deleteTenantFixture(fixture);
    }
  });
});
