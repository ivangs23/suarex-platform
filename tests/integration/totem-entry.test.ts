import { findDeviceByTotemToken } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * Modo totem, Fase 4: la ruta de entrada resuelve el tenant+venue del totem por su `totem_token`
 * (como `findTableByToken` para la mesa). Solo abre un totem si el device tiene el rol `kiosko`;
 * el token de un device que solo imprime (`agente`) no vale, ni un token inexistente.
 */
let tenant: TenantFixture;
let venueId: string;

async function insertDevice(roles: string[]): Promise<{ deviceId: string; token: string }> {
  const { data, error } = await admin
    .from("devices")
    .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Dev", roles })
    .select("id, totem_token")
    .single();
  if (error) throw error;
  return { deviceId: data.id as string, token: data.totem_token as string };
}

beforeAll(async () => {
  tenant = await createTenantFixture(`totem-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
});
afterAll(async () => {
  if (tenant) await deleteTenantFixture(tenant);
});

describe("findDeviceByTotemToken (#totem fase 4)", () => {
  it("un device con rol kiosko resuelve su tenant+venue", async () => {
    const d = await insertDevice(["kiosko"]);
    const entry = await findDeviceByTotemToken(d.token);
    expect(entry).toEqual({ tenantId: tenant.tenantId, venueId, deviceId: d.deviceId });
  });

  it("un device SIN rol kiosko (solo agente) no abre un totem", async () => {
    const d = await insertDevice(["agente"]);
    expect(await findDeviceByTotemToken(d.token)).toBeNull();
  });

  it("un token inexistente devuelve null", async () => {
    expect(await findDeviceByTotemToken("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
