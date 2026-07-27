import { getStripeConfigForManager, getStripeCredentials, setStripeConfig } from "@suarex/db";
import { afterAll, describe, expect, it } from "vitest";
import type { TenantFixture } from "./helpers/tenants.js";
import { anonClient, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

/**
 * CREDENCIALES DE STRIPE POR CLIENTE (canal QR).
 *
 * Cada cliente tiene su PROPIA cuenta de Stripe, independiente. Guardar una sola clave en el
 * entorno significaba que todos cobraban contra la misma cuenta, que es de quien fuera esa clave.
 *
 * Lo que se prueba aquí es sobre todo lo que NO puede pasar: que un secreto vuelva al navegador,
 * y que guardar uno borre el otro. Lo segundo importa más de lo que parece -- son dos secretos, y
 * perder el del webhook no impide cobrar: hace que se cobre y los pedidos NO se marquen pagados.
 * El comensal paga y la cocina no ve nada.
 */

const fixtures: TenantFixture[] = [];
afterAll(async () => {
  for (const fixture of fixtures) await deleteTenantFixture(fixture);
});

async function tenant(): Promise<TenantFixture> {
  const fixture = await createTenantFixture(`stripe-${nonce()}`);
  fixtures.push(fixture);
  return fixture;
}

describe("credenciales de Stripe de un cliente", () => {
  it("sin configurar, no hay nada y no revienta", async () => {
    const t = await tenant();
    expect(await getStripeConfigForManager(t.tenantId)).toBeNull();
    expect(await getStripeCredentials(t.tenantId)).toEqual({
      publishableKey: null,
      secretKey: null,
      webhookSecret: null,
    });
  });

  it("guardadas, el servidor las obtiene enteras para poder cobrar", async () => {
    const t = await tenant();
    await setStripeConfig(t.tenantId, {
      publishableKey: "pk_test_garum",
      secrets: { secretKey: "sk_test_garum", webhookSecret: "whsec_garum" },
    });

    expect(await getStripeCredentials(t.tenantId)).toEqual({
      publishableKey: "pk_test_garum",
      secretKey: "sk_test_garum",
      webhookSecret: "whsec_garum",
    });
  });

  it("el panel ve la clave PÚBLICA y solo los NOMBRES de los secretos", async () => {
    const t = await tenant();
    await setStripeConfig(t.tenantId, {
      publishableKey: "pk_test_x",
      secrets: { secretKey: "sk_test_SECRETO", webhookSecret: "whsec_SECRETO" },
    });

    const vista = await getStripeConfigForManager(t.tenantId);
    expect(vista?.publishableKey).toBe("pk_test_x");
    expect(vista?.secretsSet.sort()).toEqual(["secretKey", "webhookSecret"]);
    // La clave pública SÍ baja al navegador: su trabajo es montar el formulario de tarjeta.
    // Los secretos, jamás -- ni por descuido dentro del objeto.
    expect(JSON.stringify(vista)).not.toContain("SECRETO");
  });

  it("guardar UN secreto no borra el otro", async () => {
    /* Reemplazar el objeto entero dejaría fuera el que no se tocó. Con la clave secreta eso es
       dejar al cliente sin cobrar; con el secreto del webhook es peor -- se cobra y el pedido no
       se marca pagado, así que el comensal paga y la cocina no ve la comanda. */
    const t = await tenant();
    await setStripeConfig(t.tenantId, {
      publishableKey: "pk_1",
      secrets: { secretKey: "sk_original", webhookSecret: "whsec_original" },
    });

    await setStripeConfig(t.tenantId, { secrets: { secretKey: "sk_nueva" } });

    const creds = await getStripeCredentials(t.tenantId);
    expect(creds.secretKey).toBe("sk_nueva");
    expect(creds.webhookSecret, "el secreto del webhook se perdió al cambiar la clave").toBe(
      "whsec_original",
    );
  });

  it("guardar los secretos SIN mencionar la clave pública no la borra", async () => {
    const t = await tenant();
    await setStripeConfig(t.tenantId, { publishableKey: "pk_1" });
    await setStripeConfig(t.tenantId, { secrets: { secretKey: "sk_1" } });
    expect((await getStripeCredentials(t.tenantId)).publishableKey).toBe("pk_1");
  });

  it("una clave pública en blanco SÍ la borra: es un dato visible y cambiarlo es una decisión", async () => {
    const t = await tenant();
    await setStripeConfig(t.tenantId, { publishableKey: "pk_1" });
    await setStripeConfig(t.tenantId, { publishableKey: null });
    expect((await getStripeCredentials(t.tenantId)).publishableKey).toBeNull();
  });

  it("una cadena en blanco cuenta como ausencia, no como credencial vacía", async () => {
    // Una clave "" pasaría cualquier comprobación de presencia y fallaría al cobrar.
    const t = await tenant();
    await setStripeConfig(t.tenantId, { publishableKey: "   ", secrets: { secretKey: "  " } });
    const creds = await getStripeCredentials(t.tenantId);
    expect(creds.publishableKey).toBeNull();
    expect(creds.secretKey).toBeNull();
  });

  it("cada cliente ve solo lo suyo", async () => {
    const a = await tenant();
    const b = await tenant();
    await setStripeConfig(a.tenantId, { secrets: { secretKey: "sk_de_A" } });

    expect((await getStripeCredentials(b.tenantId)).secretKey).toBeNull();
  });

  it("NADIE llega a la tabla con un JWT de usuario, ni el owner", async () => {
    /* Misma postura que las credenciales del datáfono: ningún camino legítimo pasa por ahí -- el
       panel usa el service role y el cobro corre en el servidor -- así que el privilegio solo
       serviría para que una sesión robada se llevara la clave de cobro del negocio. */
    const t = await tenant();
    const { error: comoOwner } = await t.client.from("tenant_stripe_config").select("secrets");
    expect(comoOwner?.message).toContain("permission denied");

    const { error: comoAnonimo } = await anonClient()
      .from("tenant_stripe_config")
      .select("secrets");
    expect(comoAnonimo).not.toBeNull();
  });
});
