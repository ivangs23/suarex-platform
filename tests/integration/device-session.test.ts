import { createDeviceClient, type SessionStore, signInAndPersistSession } from "@suarex/agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteMembershipFixtureUser,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * #11: el device se autentica por SESIÓN PERSISTIDA (refresh token cifrado), no guardando la
 * contraseña. Aquí se prueba el mecanismo de `@suarex/agent`: `signInAndPersistSession` deja la
 * sesión en un `SessionStore`, y `createDeviceClient({ sessionStore })` la restaura sin
 * contraseña. Y, sobre todo, la propiedad de seguridad que motiva el cambio: al REVOCAR la
 * cuenta (lo que hace `resetDevice` -> `deleteUser`), el refresh token guardado deja de servir.
 */
const url = process.env.SUPABASE_URL as string;
const anonKey = process.env.SUPABASE_ANON_KEY as string;

/** `SessionStore` en memoria (el de producción lo respalda DPAPI). Solo hay una sesión, así que
 *  la `key` no se distingue. */
function memStore(): SessionStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

let tenant: TenantFixture;
const userIds: string[] = [];

async function seedDeviceAccount(): Promise<{ email: string; password: string; userId: string }> {
  const email = `sess-device-${nonce()}@devices.local`;
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
  return { email, password, userId };
}

beforeAll(async () => {
  tenant = await createTenantFixture(`sess-${nonce()}`);
});
afterAll(async () => {
  for (const id of userIds) await deleteMembershipFixtureUser(id);
  if (tenant) await deleteTenantFixture(tenant);
});

describe("sesión del device por refresh token (#11)", () => {
  it("persiste la sesión y la restaura sin contraseña", async () => {
    const { email, password } = await seedDeviceAccount();
    const store = memStore();

    await signInAndPersistSession(url, anonKey, store, email, password);

    // El store guarda la sesión (con refresh token), NUNCA la contraseña.
    const persisted = store.getItem("suarex-device-session");
    expect(persisted, "no se persistió ninguna sesión").toBeTruthy();
    expect(persisted).not.toContain(password);
    expect(persisted).toContain("refresh_token");

    // Restaurar sin contraseña: createDeviceClient valida y renueva el refresh token.
    const client = await createDeviceClient({ supabaseUrl: url, anonKey, sessionStore: store });
    const { data, error } = await client.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.email).toBe(email);
  });

  it("tras revocar la cuenta (deleteUser), el refresh token guardado deja de servir", async () => {
    const { email, password, userId } = await seedDeviceAccount();
    const store = memStore();
    await signInAndPersistSession(url, anonKey, store, email, password);

    // Revocación como la de `resetDevice`: borrar la cuenta Auth invalida sus refresh tokens.
    const { error: delError } = await admin.auth.admin.deleteUser(userId);
    expect(delError).toBeNull();
    userIds.splice(userIds.indexOf(userId), 1); // ya borrado; no reintentar en afterAll

    // La restauración debe fallar -> la cáscara lo trata como "hay que re-emparejar".
    await expect(
      createDeviceClient({ supabaseUrl: url, anonKey, sessionStore: store }),
    ).rejects.toThrow();
  });
});
