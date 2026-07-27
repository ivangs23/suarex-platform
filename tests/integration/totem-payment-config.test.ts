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
      payment_terminal_id: pinpad,
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
      provider: "paytef",
      config: { accessKey: "MS4yaGc1", companyId: "115925" },
      secrets: { secretKey: "un-secreto-de-prueba" },
      mock: true,
    });
    const d = await seedTotemDevice("02290357044");

    const cfg = await getPaymentConfigForDevice(d.client);
    expect(cfg).not.toBeNull();
    expect(cfg?.provider).toBe("paytef");
    expect(cfg?.config).toEqual({ accessKey: "MS4yaGc1", companyId: "115925" });
    expect(cfg?.secrets).toEqual({ secretKey: "un-secreto-de-prueba" });
    expect(cfg?.mock).toBe(true);
    // El terminal viene del DISPOSITIVO, no de la cuenta.
    expect(cfg?.terminalId).toBe("02290357044");
  });

  it("el device NO puede leer `tenant_payment_config` directamente (RLS lo niega)", async () => {
    const d = await seedTotemDevice(null);
    const { data } = await d.client.from("tenant_payment_config").select("secrets");
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
        provider: "paytef",
        config: { accessKey: "AK1", companyId: "42" },
        secrets: { secretKey: "sk-oculta" },
        mock: false,
      });
      const cfg = await getPaymentConfigForManager(t.tenantId);
      expect(cfg).toEqual({
        provider: "paytef",
        config: { accessKey: "AK1", companyId: "42" },
        // Qué secretos hay puestos, nunca su valor.
        secretsSet: ["secretKey"],
        mock: false,
      });
      expect(JSON.stringify(cfg)).not.toContain("sk-oculta");
    } finally {
      await deleteTenantFixture(t);
    }
  });

  it("editar con el secreto en blanco CONSERVA el secreto guardado", async () => {
    const t = await createTenantFixture(`pay-keep-${nonce()}`);
    try {
      await setPaymentConfig(t.tenantId, {
        provider: "paytef",
        config: { accessKey: "AK1", companyId: "1" },
        secrets: { secretKey: "sk-original" },
        mock: true,
      });
      // Segundo guardado sin secreto: cambia lo demás, conserva la clave.
      await setPaymentConfig(t.tenantId, {
        provider: "paytef",
        config: { accessKey: "AK2", companyId: "2" },
        mock: false,
      });

      const { data } = await admin
        .from("tenant_payment_config")
        .select("config, secrets, mock")
        .eq("tenant_id", t.tenantId)
        .single();
      expect(data?.config).toEqual({ accessKey: "AK2", companyId: "2" });
      expect(data?.mock).toBe(false);
      expect(data?.secrets).toEqual({ secretKey: "sk-original" }); // no se pisó
    } finally {
      await deleteTenantFixture(t);
    }
  });

  it("el PRIMER alta sin secreto se rechaza (MissingPaymentSecretError)", async () => {
    const t = await createTenantFixture(`pay-nosec-${nonce()}`);
    try {
      await expect(
        setPaymentConfig(t.tenantId, {
          provider: "paytef",
          config: { accessKey: "AK1" },
          mock: true,
          requiredSecrets: ["secretKey"],
        }),
      ).rejects.toBeInstanceOf(MissingPaymentSecretError);
      // Y no dejó ninguna fila a medias.
      expect(await getPaymentConfigForManager(t.tenantId)).toBeNull();
    } finally {
      await deleteTenantFixture(t);
    }
  });
});

/**
 * FASE 1 de los métodos de pago configurables: el esquema deja de hablar en Paytef y guarda
 * `config`/`secrets` genéricos, pero la RPC vieja sigue viva.
 *
 * Ese segundo punto es el que de verdad se prueba aquí. En el local de un cliente hay un Electron
 * con una build que llama a `get_payment_config_self()` esperando seis columnas concretas: si eso
 * dejara de funcionar, ese totem no cobraría hasta actualizarse. Estos tests son lo que impide que
 * un refactor del esquema pare una caja en horario de servicio.
 */
describe("config de pago genérica (#19/#20)", () => {
  /** Escribe directamente el formato NUEVO, como hará el panel a partir de la fase 2. */
  async function guardaFormatoNuevo(values: {
    config: Record<string, string>;
    secrets: Record<string, string>;
    provider?: string;
    mock?: boolean;
  }) {
    const { error } = await admin.from("tenant_payment_config").upsert({
      tenant_id: tenant.tenantId,
      provider: values.provider ?? "paytef",
      config: values.config,
      secrets: values.secrets,
      mock: values.mock ?? false,
    });
    if (error) throw error;
  }

  it("la RPC nueva devuelve los objetos tal cual, más el terminal de ESTE dispositivo", async () => {
    await guardaFormatoNuevo({
      config: { accessKey: "AK-1", companyId: "C-1" },
      secrets: { secretKey: "SK-1" },
    });
    const { client } = await seedTotemDevice("TERM-9");

    const { data, error } = await client.rpc("get_payment_config_self_v2");
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      provider: "paytef",
      config: { accessKey: "AK-1", companyId: "C-1" },
      secrets: { secretKey: "SK-1" },
      mock: false,
      terminal_id: "TERM-9",
    });
  });

  it("un agente VIEJO sigue viendo la config aunque ya esté guardada en el formato nuevo", async () => {
    // Sin la caída a los objetos, la compatibilidad duraría solo hasta la primera vez que
    // alguien tocara los ajustes de pago desde el panel.
    await guardaFormatoNuevo({
      config: { accessKey: "AK-2", companyId: "C-2" },
      secrets: { secretKey: "SK-2" },
    });
    const { client } = await seedTotemDevice("TERM-8");

    const { data, error } = await client.rpc("get_payment_config_self");
    expect(error).toBeNull();
    expect(data?.[0]).toMatchObject({
      provider: "paytef",
      access_key: "AK-2",
      secret_key: "SK-2",
      company_id: "C-2",
      // El nombre de columna que el agente desplegado espera, no el nuevo.
      pinpad_id: "TERM-8",
    });
  });

  it("un proveedor que no es Paytef se guarda sin pelearse con ninguna restricción", async () => {
    // El `check (provider in ('paytef'))` obligaba a una migración por proveedor nuevo. Quien
    // decide si un proveedor existe es el registro del agente, no la base.
    await guardaFormatoNuevo({
      provider: "otro-tpv",
      config: { loQueSea: "1" },
      secrets: { token: "T-1" },
    });
    const { client } = await seedTotemDevice("TERM-7");

    const { data } = await client.rpc("get_payment_config_self_v2");
    expect(data?.[0]).toMatchObject({ provider: "otro-tpv", config: { loQueSea: "1" } });
  });

  it("un provider vacío sí se rechaza: es un dato corrupto, no un proveedor futuro", async () => {
    const { error } = await admin.from("tenant_payment_config").upsert({
      tenant_id: tenant.tenantId,
      provider: "",
      config: {},
      secrets: {},
    });
    expect(error).not.toBeNull();
  });

  it("a un anónimo ni se le deja llamar: la RPC no está concedida a ese rol", async () => {
    const { error } = await anonClient().rpc("get_payment_config_self_v2");
    expect(error?.message).toContain("permission denied");
  });

  it("un usuario autenticado que NO es un dispositivo no obtiene nada", async () => {
    /* Este es el aislamiento que de verdad importa: el owner del tenant SÍ puede ejecutar la
       función (está concedida a `authenticated`), pero no tiene fila en `devices`, así que la
       consulta acotada por `auth.uid()` no le devuelve ni el secreto ni nada. Sin este caso, el
       test del anónimo daría una falsa sensación de seguridad: rechaza por el GRANT, no por el
       acotado, y el GRANT no protege de un miembro del propio tenant. */
    await guardaFormatoNuevo({ config: { accessKey: "AK-9" }, secrets: { secretKey: "SK-9" } });

    const { data, error } = await tenant.client.rpc("get_payment_config_self_v2");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("un device NO puede leer los secretos por la tabla, ni con el formato nuevo", async () => {
    await guardaFormatoNuevo({ config: { accessKey: "AK-3" }, secrets: { secretKey: "SK-3" } });
    const { client } = await seedTotemDevice("TERM-6");

    const { data } = await client.from("tenant_payment_config").select("secrets");
    expect(data ?? [], "un device pudo leer los secretos por la tabla").toHaveLength(0);
  });
});
