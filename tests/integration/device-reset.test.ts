import { pairDevice, resetDevice } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anonClient,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenant: TenantFixture;
let venueId: string;
const orphanUserIds: string[] = [];

beforeAll(async () => {
  tenant = await createTenantFixture(`reset-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "v", name: "V", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
});
afterAll(async () => {
  for (const id of orphanUserIds) {
    if (!id) continue; // marcador vacío, ver el comentario en el test que lo empuja
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  if (tenant) await deleteTenantFixture(tenant);
});

async function newPairedDevice(): Promise<{
  deviceId: string;
  email: string;
  password: string;
  userId: string;
}> {
  const code = `RESET-${nonce()}`;
  const { data: device } = await admin
    .from("devices")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Agente",
      pairing_code: code,
      pairing_expires_at: new Date(Date.now() + 60_000).toISOString(),
    })
    .select("id")
    .single();
  const result = await pairDevice(code);
  const { data: row } = await admin
    .from("devices")
    .select("auth_user_id")
    .eq("id", device?.id)
    .single();
  return {
    deviceId: device?.id as string,
    email: result?.email as string,
    password: result?.password as string,
    userId: row?.auth_user_id as string,
  };
}

describe("resetDevice", () => {
  it("borra la cuenta, desempareja y emite un código nuevo; las credenciales viejas ya no sirven", async () => {
    const dev = await newPairedDevice();

    // Antes del reset, las credenciales viejas inician sesión.
    const before = anonClient();
    const { error: beforeErr } = await before.auth.signInWithPassword({
      email: dev.email,
      password: dev.password,
    });
    expect(beforeErr).toBeNull();

    const { pairingCode, expiresAt } = await resetDevice(tenant.tenantId, dev.deviceId);
    expect(pairingCode.length).toBeGreaterThanOrEqual(32);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    // La cuenta de Auth vieja ya no existe → membership borrada, auth_user_id a null.
    // NOTA (verificado contra supabase-js): getUserById de un usuario borrado devuelve
    // { data: { user: null }, error } (el error puede o no venir poblado según versión);
    // lo que prueba que la cuenta ya no existe es `user === null`, no la presencia de error.
    const { data: userRow } = await admin.auth.admin.getUserById(dev.userId);
    expect(userRow?.user).toBeNull();
    const { data: memberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("user_id", dev.userId);
    expect(memberships).toHaveLength(0);
    const { data: deviceRow } = await admin
      .from("devices")
      .select("auth_user_id, paired_at, pairing_code")
      .eq("id", dev.deviceId)
      .single();
    expect(deviceRow?.auth_user_id).toBeNull();
    expect(deviceRow?.paired_at).toBeNull();
    expect(deviceRow?.pairing_code).toBe(pairingCode);

    // Credenciales viejas ya no inician sesión (usuario borrado).
    const after = anonClient();
    const { error: afterErr } = await after.auth.signInWithPassword({
      email: dev.email,
      password: dev.password,
    });
    expect(afterErr).not.toBeNull();

    // El código nuevo empareja un "PC de repuesto" con credenciales frescas que resuelven el tenant.
    const fresh = await pairDevice(pairingCode);
    expect(fresh?.tenantId).toBe(tenant.tenantId);
    // No se empuja ningún marcador: la cuenta fresca la limpia `deleteTenantFixture` por
    // cascada (memberships -> tenant), así que no hace falta borrarla explícitamente aquí
    // (empujar un id vacío haría que el afterAll llamara a deleteUser("") sin necesidad).
    const client = anonClient();
    const { error: freshErr } = await client.auth.signInWithPassword({
      email: fresh?.email as string,
      password: fresh?.password as string,
    });
    expect(freshErr).toBeNull();
  });

  it("un device nunca emparejado se resetea sin error (no hay cuenta que borrar)", async () => {
    const { data: device } = await admin
      .from("devices")
      .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Sin emparejar" })
      .select("id")
      .single();
    const { pairingCode } = await resetDevice(tenant.tenantId, device?.id as string);
    expect(pairingCode.length).toBeGreaterThanOrEqual(32);
  });
});
