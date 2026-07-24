import {
  getPaymentConfigForDevice,
  getPaymentConfigForManager,
  MissingPaymentSecretError,
  setPaymentConfig,
} from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anonClient,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * Sub-proyecto 4, Fase 1: la config de pago (Paytef) del tenant. El `secret_key` es sensible, así
 * que el rol `device` NO puede leer la tabla directamente -- solo por la RPC `get_payment_config_self`
 * (SECURITY DEFINER, acotada al device que llama). Esto prueba: el device obtiene la config de SU
 * tenant con su propio pinpad; NO puede leer la tabla directamente; y no ve la de otro tenant.
 */
let tenant: TenantFixture;
let venueId: string;
const userIds: string[] = [];

async function seedTotemDevice(pinpad: string | null) {
  const email = `pay-device-${nonce()}@devices.local`;
  const password = `pw-${nonce()}`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = user.user.id;
  userIds.push(userId);
  await admin
    .from("memberships")
    .insert({ user_id: userId, tenant_id: tenant.tenantId, role: "device" });
  const { data: device } = await admin
    .from("devices")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Totem",
      auth_user_id: userId,
      pinpad_id: pinpad,
    })
    .select("id")
    .single();
  const client = anonClient();
  await client.auth.signInWithPassword({ email, password });
  return { client, deviceId: device?.id as string };
}

beforeAll(async () => {
  tenant = await createTenantFixture(`pay-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
});
afterAll(async () => {
  for (const id of userIds) await deleteMembershipFixtureUser(id);
  if (tenant) await deleteTenantFixture(tenant);
});

describe("config de pago del totem (#totem fase 1)", () => {
  it("el device obtiene la config Paytef de su tenant, con su propio pinpad", async () => {
    await setPaymentConfig(tenant.tenantId, {
      accessKey: "MS4yaGc1",
      secretKey: "un-secreto-de-prueba",
      companyId: "115925",
      mock: true,
    });
    const d = await seedTotemDevice("02290357044");

    const cfg = await getPaymentConfigForDevice(d.client);
    expect(cfg).not.toBeNull();
    expect(cfg?.accessKey).toBe("MS4yaGc1");
    expect(cfg?.secretKey).toBe("un-secreto-de-prueba");
    expect(cfg?.companyId).toBe("115925");
    expect(cfg?.mock).toBe(true);
    expect(cfg?.pinpadId).toBe("02290357044");
  });

  it("el device NO puede leer `tenant_payment_config` directamente (RLS lo niega)", async () => {
    const d = await seedTotemDevice(null);
    const { data } = await d.client.from("tenant_payment_config").select("secret_key");
    // Sin policy que le aplique al rol device -> cero filas (el secreto no se filtra por SELECT).
    expect(data).toEqual([]);
  });

  it("un device sin config de pago (otro tenant) obtiene null", async () => {
    const otro = await createTenantFixture(`pay-b-${nonce()}`);
    const { data: venueB } = await admin
      .from("venues")
      .insert({ tenant_id: otro.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
      .select("id")
      .single();

    const email = `pay-b-${nonce()}@devices.local`;
    const password = `pw-${nonce()}`;
    const { data: user } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    const userId = user?.user?.id as string;
    await admin
      .from("memberships")
      .insert({ user_id: userId, tenant_id: otro.tenantId, role: "device" });
    await admin.from("devices").insert({
      tenant_id: otro.tenantId,
      venue_id: venueB?.id,
      name: "Totem B",
      auth_user_id: userId,
    });
    const client = anonClient();
    await client.auth.signInWithPassword({ email, password });

    // El tenant B no tiene config -> null (y jamás la de A).
    expect(await getPaymentConfigForDevice(client)).toBeNull();

    await deleteMembershipFixtureUser(userId);
    await deleteTenantFixture(otro);
  });
});

describe("config de pago para el PANEL (owner/admin, #totem fase 6)", () => {
  it("getPaymentConfigForManager devuelve la config SIN el secreto, solo si lo hay", async () => {
    const t = await createTenantFixture(`pay-mgr-${nonce()}`);
    try {
      expect(await getPaymentConfigForManager(t.tenantId)).toBeNull();

      await setPaymentConfig(t.tenantId, {
        accessKey: "AK1",
        secretKey: "sk-oculta",
        companyId: "42",
        mock: false,
      });
      const cfg = await getPaymentConfigForManager(t.tenantId);
      expect(cfg).toEqual({ accessKey: "AK1", companyId: "42", mock: false, hasSecret: true });
      // El tipo no expone el secreto; se comprueba que tampoco viene por sorpresa en el objeto.
      expect(JSON.stringify(cfg)).not.toContain("sk-oculta");
    } finally {
      await deleteTenantFixture(t);
    }
  });

  it("editar con el secreto en blanco CONSERVA el secreto guardado", async () => {
    const t = await createTenantFixture(`pay-keep-${nonce()}`);
    try {
      await setPaymentConfig(t.tenantId, {
        accessKey: "AK1",
        secretKey: "sk-original",
        companyId: "1",
        mock: true,
      });
      // Segundo guardado sin secreto: cambia lo demás, conserva la clave.
      await setPaymentConfig(t.tenantId, { accessKey: "AK2", companyId: "2", mock: false });

      const { data } = await admin
        .from("tenant_payment_config")
        .select("access_key, company_id, mock, secret_key")
        .eq("tenant_id", t.tenantId)
        .single();
      expect(data?.access_key).toBe("AK2");
      expect(data?.company_id).toBe("2");
      expect(data?.mock).toBe(false);
      expect(data?.secret_key).toBe("sk-original"); // no se pisó
    } finally {
      await deleteTenantFixture(t);
    }
  });

  it("el PRIMER alta sin secreto se rechaza (MissingPaymentSecretError)", async () => {
    const t = await createTenantFixture(`pay-nosec-${nonce()}`);
    try {
      await expect(
        setPaymentConfig(t.tenantId, { accessKey: "AK1", mock: true }),
      ).rejects.toBeInstanceOf(MissingPaymentSecretError);
      // Y no dejó ninguna fila a medias.
      expect(await getPaymentConfigForManager(t.tenantId)).toBeNull();
    } finally {
      await deleteTenantFixture(t);
    }
  });
});
