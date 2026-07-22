import { pairDevice } from "@suarex/db";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, createTenantFixture, nonce, type TenantFixture } from "./helpers/tenants.js";

let tenant: TenantFixture;
let venueId: string;

beforeAll(async () => {
  tenant = await createTenantFixture(`dev-${nonce()}`);
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: "p", name: "P", is_default: true })
    .select("id")
    .single();
  venueId = venue?.id as string;
});

async function newDeviceWithCode(code: string, expiresInMs: number): Promise<string> {
  const { data } = await admin
    .from("devices")
    .insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Agente cocina",
      pairing_code: code,
      pairing_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    })
    .select("id")
    .single();
  return data?.id as string;
}

describe("pairDevice", () => {
  it("canjea un código válido y devuelve credenciales que resuelven el tenant", async () => {
    const code = `PAIR-${nonce()}`;
    await newDeviceWithCode(code, 60_000);

    const result = await pairDevice(code);
    expect(result).not.toBeNull();
    expect(result?.tenantId).toBe(tenant.tenantId);

    // Las credenciales sirven, y el claim del JWT lleva el tenant correcto.
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_ANON_KEY as string,
      {
        auth: { persistSession: false },
      },
    );
    const { error } = await client.auth.signInWithPassword({
      email: result?.email as string,
      password: result?.password as string,
    });
    expect(error).toBeNull();
    const { data } = await client.auth.getClaims();
    expect(data?.claims?.tenant_id).toBe(tenant.tenantId);
  });

  it("un código caducado no empareja", async () => {
    const code = `EXP-${nonce()}`;
    await newDeviceWithCode(code, -1000);
    expect(await pairDevice(code)).toBeNull();
  });

  it("un código inexistente devuelve null, sin revelar nada", async () => {
    expect(await pairDevice(`NOPE-${nonce()}`)).toBeNull();
  });

  it("el código es de un solo uso: tras canjear, no vuelve a servir", async () => {
    const code = `ONCE-${nonce()}`;
    await newDeviceWithCode(code, 60_000);
    expect(await pairDevice(code)).not.toBeNull();
    expect(await pairDevice(code)).toBeNull();
  });
});
