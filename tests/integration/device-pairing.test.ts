import { randomUUID } from "node:crypto";
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

  // C1 fix round 1 -- Bug 1 (crítico, TOCTOU). Antes del fix, `pairDevice` hacía un
  // SELECT (código no caducado) y solo mucho más tarde -- tras `createUser` y el INSERT
  // de `memberships` -- un UPDATE que borraba `pairing_code`. Dos llamadas concurrentes
  // con el mismo código pasaban ambas el SELECT antes de que ninguna borrara nada, así
  // que las dos acababan devolviendo credenciales válidas: el código, pensado como de un
  // solo uso, servía dos veces. Este test dispara las dos llamadas con `Promise.all`
  // (sin await intermedio, para que de verdad se solapen) y exige que gane exactamente
  // una. Contra el código viejo (no atómico) este test FALLA -- `winners` tiene longitud
  // 2 -- y contra el canje atómico (`UPDATE ... WHERE pairing_code = $1 AND
  // pairing_expires_at > now() ... RETURNING`, sin SELECT previo) PASA: la evidencia de
  // ambas ejecuciones está en el informe de esta tarea.
  it("dos canjes concurrentes del mismo código: gana exactamente uno, nunca dos", async () => {
    const code = `RACE-${nonce()}`;
    const deviceId = await newDeviceWithCode(code, 60_000);

    const [first, second] = await Promise.all([pairDevice(code), pairDevice(code)]);
    const winners = [first, second].filter((result) => result !== null);
    expect(winners).toHaveLength(1);

    const { data: deviceRow } = await admin
      .from("devices")
      .select("auth_user_id, pairing_code")
      .eq("id", deviceId)
      .single();
    expect(deviceRow?.pairing_code).toBeNull();
    expect(deviceRow?.auth_user_id).not.toBeNull();

    // Exactamente una membership para el usuario de este dispositivo en este tenant --
    // si el bug reapareciera y las dos llamadas ganaran, cada una insertaría/upsertearía
    // con su propio `authUserId`, así que este conteo por el `auth_user_id` que quedó
    // enlazado en `devices` no bastaría por sí solo; se complementa con el conteo de
    // cuentas de Auth de abajo, que si el bug reapareciera sería 2, no 1.
    const { data: memberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("user_id", deviceRow?.auth_user_id as string)
      .eq("tenant_id", tenant.tenantId);
    expect(memberships).toHaveLength(1);

    const email = `device-${deviceId}@devices.local`;
    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const matches = (usersPage?.users ?? []).filter((user) => user.email === email);
    expect(matches).toHaveLength(1);
  });

  // C1 fix round 1 -- Bug 2 (importante, cuenta huérfana). Como el canje atómico de
  // arriba borra `pairing_code` ANTES de que exista la cuenta de Auth, un fallo real
  // entre "crear la cuenta" y "insertar la membership" deja una cuenta de Auth con el
  // email determinista del dispositivo (`device-{id}@devices.local`) pero sin
  // membership, y el código original ya no sirve para volver a encontrar la fila. Este
  // test reproduce exactamente ese estado a mano (el canje, luego la cuenta de Auth,
  // parando ahí -- sin membership, sin `auth_user_id` enlazado) y después simula el
  // reintento real: una fila nueva de `pairing_code` sobre el MISMO dispositivo (lo que
  // haría el futuro panel de administración), y una nueva llamada a `pairDevice`.
  it("una cuenta huérfana entre crear la cuenta y la membership no bloquea el reintento", async () => {
    const code1 = `ORPHAN1-${nonce()}`;
    const deviceId = await newDeviceWithCode(code1, 60_000);
    const email = `device-${deviceId}@devices.local`;

    const { error: claimSimError } = await admin
      .from("devices")
      .update({ pairing_code: null, paired_at: new Date().toISOString() })
      .eq("id", deviceId);
    expect(claimSimError).toBeNull();

    const { data: orphanUser, error: orphanUserError } = await admin.auth.admin.createUser({
      email,
      password: randomUUID(),
      email_confirm: true,
    });
    expect(orphanUserError).toBeNull();
    const orphanUserId = orphanUser?.user?.id as string;

    // El reintento llega con un código NUEVO: el original ya se consumió en el canje
    // atómico simulado arriba (de un solo uso a propósito, ese comportamiento no
    // cambia).
    const code2 = `ORPHAN2-${nonce()}`;
    const { error: reassignError } = await admin
      .from("devices")
      .update({
        pairing_code: code2,
        pairing_expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", deviceId);
    expect(reassignError).toBeNull();

    const result = await pairDevice(code2);
    expect(result).not.toBeNull();
    expect(result?.deviceId).toBe(deviceId);
    expect(result?.email).toBe(email);

    // Exactamente una cuenta de Auth para este email: la huérfana, REUTILIZADA -- no
    // una segunda creada por encima.
    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const matches = (usersPage?.users ?? []).filter((user) => user.email === email);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(orphanUserId);

    // Exactamente una membership.
    const { data: memberships } = await admin
      .from("memberships")
      .select("user_id")
      .eq("user_id", orphanUserId)
      .eq("tenant_id", tenant.tenantId);
    expect(memberships).toHaveLength(1);

    // Las credenciales del reintento funcionan de verdad -- la contraseña se reseteó
    // (nunca se guarda en claro la de un intento anterior, así que no podían ser esas).
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_ANON_KEY as string,
      { auth: { persistSession: false } },
    );
    const { error: signInError } = await client.auth.signInWithPassword({
      email: result?.email as string,
      password: result?.password as string,
    });
    expect(signInError).toBeNull();
    const { data: claims } = await client.auth.getClaims();
    expect(claims?.claims?.tenant_id).toBe(tenant.tenantId);
  });
});
