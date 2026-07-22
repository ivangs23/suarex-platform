import { createDevice, listDevices, pairDevice, regeneratePairingCode } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenant: TenantFixture;
let tenantB: TenantFixture;
let venueId: string;
let venueIdB: string;

/**
 * Ids de dispositivos que este fichero llega a emparejar de verdad vía `pairDevice`
 * (crea/enlaza una cuenta de Auth de servicio con email determinista
 * `device-{id}@devices.local`, ver `device-pairing.test.ts` para el mismo patrón). Se
 * recogen aquí para poder borrar SOLO esas cuentas concretas en el `afterAll` -- nunca
 * un `listUsers`/wipe general de `auth.users`. Los dispositivos que este fichero crea
 * pero nunca empareja (código caducado, etc.) no tienen `auth_user_id` que limpiar: sus
 * filas desaparecen solas en cascada cuando se borra el tenant.
 */
const pairedDeviceIds: string[] = [];

beforeAll(async () => {
  tenant = await createTenantFixture(`adev-${nonce()}`);
  tenantB = await createTenantFixture(`adevb-${nonce()}`);

  const { data: v, error: vError } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  if (vError) throw vError;
  venueId = v?.id as string;

  const { data: vb, error: vbError } = await admin
    .from("venues")
    .insert({ tenant_id: tenantB.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  if (vbError) throw vbError;
  venueIdB = vb?.id as string;
});

afterAll(async () => {
  if (pairedDeviceIds.length > 0) {
    const { data: rows, error } = await admin
      .from("devices")
      .select("auth_user_id")
      .in("id", pairedDeviceIds);
    if (error) throw error;
    const authUserIds = (rows ?? [])
      .map((row) => row.auth_user_id as string | null)
      .filter((id): id is string => id !== null);
    for (const authUserId of authUserIds) {
      const { error: deleteUserError } = await admin.auth.admin.deleteUser(authUserId);
      if (deleteUserError) throw deleteUserError;
    }
  }
  for (const fixture of [tenant, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

describe("createDevice", () => {
  it("genera un código largo y aleatorio que empareja de verdad", async () => {
    const created = await createDevice(tenant.tenantId, { venueId, name: "Agente cocina" });
    expect(created.pairingCode.length).toBeGreaterThanOrEqual(32);

    // El código recién generado canjea correctamente (ida y vuelta con pairDevice).
    const paired = await pairDevice(created.pairingCode);
    pairedDeviceIds.push(created.id);
    expect(paired?.tenantId).toBe(tenant.tenantId);
  });

  it("dos dispositivos generan códigos distintos", async () => {
    const a = await createDevice(tenant.tenantId, { venueId, name: "A" });
    const b = await createDevice(tenant.tenantId, { venueId, name: "B" });
    expect(a.pairingCode).not.toBe(b.pairingCode);
  });

  it("un código caduca según ttlMinutes", async () => {
    const created = await createDevice(tenant.tenantId, { venueId, name: "C", ttlMinutes: -1 });
    // Ya caducado: no empareja.
    expect(await pairDevice(created.pairingCode)).toBeNull();
  });

  it("no se puede regenerar el código de un dispositivo ya emparejado", async () => {
    const created = await createDevice(tenant.tenantId, { venueId, name: "D" });
    await pairDevice(created.pairingCode); // ahora está paired
    pairedDeviceIds.push(created.id);
    await expect(regeneratePairingCode(tenant.tenantId, created.id)).rejects.toThrow();
  });

  it("regeneratePairingCode funciona en un dispositivo pendiente (aún no emparejado)", async () => {
    const created = await createDevice(tenant.tenantId, { venueId, name: "E" });

    const regenerated = await regeneratePairingCode(tenant.tenantId, created.id);
    expect(regenerated.pairingCode.length).toBeGreaterThanOrEqual(32);
    expect(regenerated.pairingCode).not.toBe(created.pairingCode);

    // El código original quedó sobreescrito: ya no empareja. El nuevo sí.
    expect(await pairDevice(created.pairingCode)).toBeNull();
    const paired = await pairDevice(regenerated.pairingCode);
    pairedDeviceIds.push(created.id);
    expect(paired?.tenantId).toBe(tenant.tenantId);
  });

  it("regeneratePairingCode rechaza un deviceId inexistente", async () => {
    await expect(
      regeneratePairingCode(tenant.tenantId, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow();
  });

  it("un venueId de otro tenant es rechazado (trigger assert_same_tenant)", async () => {
    await expect(
      createDevice(tenant.tenantId, { venueId: venueIdB, name: "Intruso" }),
    ).rejects.toThrow(/cross-tenant/i);
  });
});

describe("listDevices", () => {
  it("nunca expone el pairing_code en claro, solo si hay uno pendiente y cuándo caduca", async () => {
    const created = await createDevice(tenant.tenantId, { venueId, name: "Listado" });

    const devices = await listDevices(tenant.tenantId);
    const row = devices.find((d) => d.id === created.id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("pairingCode");
    expect(row).not.toHaveProperty("pairing_code");
    expect(row?.hasPendingPairingCode).toBe(true);
    // Postgres devuelve el timestamptz con offset "+00:00" en vez del "Z" que produce
    // `Date#toISOString()` en el valor original -- se compara por instante, no por
    // igualdad textual.
    expect(new Date(row?.pairingExpiresAt as string).getTime()).toBe(
      new Date(created.expiresAt).getTime(),
    );

    // Ningún valor devuelto por listDevices contiene el código en claro, bajo ningún
    // nombre de campo.
    expect(JSON.stringify(row)).not.toContain(created.pairingCode);
  });
});
