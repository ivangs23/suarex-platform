import { getTenantStripeAccount } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

/**
 * LA RAMA DE STRIPE CONNECT, EN EL SERVIDOR.
 *
 * `getTenantStripeAccount` decide SOBRE QUÉ CUENTA se crea el cargo, y por tanto quién recibe
 * el dinero: la cuenta conectada del restaurante, o la de la plataforma como respaldo.
 *
 * No la cubría ningún test: ninguno ponía `stripe_account_id`, así que los 111 e2e recorrían
 * siempre el respaldo -- el camino de desarrollo y de un tenant sin onboarding terminado --
 * mientras que la rama Connect es la que usa todo cliente real. Es la misma forma del fallo de
 * la clave publicable: invisible en desarrollo, roto para todos en producción.
 */
describe("getTenantStripeAccount", () => {
  it("devuelve la cuenta conectada cuando el tenant la tiene", async () => {
    const f = await createTenantFixture(`conn-${nonce()}`);
    try {
      await admin
        .from("tenants")
        .update({ stripe_account_id: "acct_del_restaurante" })
        .eq("id", f.tenantId);

      expect(await getTenantStripeAccount(f.tenantId)).toBe("acct_del_restaurante");
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("devuelve null sin onboarding, para que se cobre por la plataforma", async () => {
    // Un tenant recién dado de alta todavía no tiene cuenta. Si esto lanzara en vez de
    // devolver null, no se podría cobrar en absoluto durante sus primeros días.
    const f = await createTenantFixture(`sinconn-${nonce()}`);
    try {
      expect(await getTenantStripeAccount(f.tenantId)).toBeNull();
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("NUNCA devuelve la cuenta de otro tenant", async () => {
    // El control que de verdad importa: si esta consulta se cruzara, el cargo se crearía sobre
    // la cuenta de otro restaurante y el dinero acabaría en la caja equivocada. Se lee de
    // `tenants` por su propia `id` (exención documentada en client.ts), así que lo que se fija
    // aquí es que ese filtro existe y funciona.
    const a = await createTenantFixture(`ca-${nonce()}`);
    const b = await createTenantFixture(`cb-${nonce()}`);
    try {
      await admin.from("tenants").update({ stripe_account_id: "acct_de_B" }).eq("id", b.tenantId);

      expect(await getTenantStripeAccount(a.tenantId), "A no puede ver la cuenta de B").toBeNull();
      expect(await getTenantStripeAccount(b.tenantId)).toBe("acct_de_B");
    } finally {
      await deleteTenantFixture(a);
      await deleteTenantFixture(b);
    }
  });

  it("un id inventado no devuelve ninguna cuenta", async () => {
    // `maybeSingle()` sobre cero filas devuelve null, no un error: un id que no existe no debe
    // acabar cobrando por la plataforma sin que nadie lo note, ni reventar la creación del
    // pedido.
    expect(await getTenantStripeAccount("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
