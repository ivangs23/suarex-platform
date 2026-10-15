import {
  createDeviceClient,
  DEVICE_SESSION_STORAGE_KEY,
  esSinConexion,
  SesionInvalidaError,
  type SessionStore,
  SinConexionError,
  signInAndPersistSession,
} from "@suarex/agent";
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

    // La restauración debe fallar como sesión INVÁLIDA (hay que re-emparejar), no como un fallo
    // de red que la cáscara reintentaría para siempre sin arreglar nada.
    await expect(
      createDeviceClient({ supabaseUrl: url, anonKey, sessionStore: store }),
    ).rejects.toBeInstanceOf(SesionInvalidaError);
  });

  it("sin sesión guardada pide re-emparejar", async () => {
    await expect(
      createDeviceClient({ supabaseUrl: url, anonKey, sessionStore: memStore() }),
    ).rejects.toBeInstanceOf(SesionInvalidaError);
  });
});

/**
 * Un PC de cocina arranca muchas veces sin red (la wifi conecta después, o un corte de luz
 * reinició también el router). Validado en un Windows 11 real: el agente lo tomaba por una sesión
 * que no valía, pedía re-emparejar y se quedaba parado para siempre aunque la red volviera.
 */
describe("sin red, la sesión del device sigue siendo buena", () => {
  /** Nada escucha en el puerto 1: la conexión se rechaza en el acto, como sin red. */
  const SIN_RED = "http://127.0.0.1:1";

  it("es un fallo de red (se reintenta), no una sesión inválida, y la sesión guardada no se toca", async () => {
    const { email, password } = await seedDeviceAccount();
    const store = memStore();
    await signInAndPersistSession(url, anonKey, store, email, password);
    const antes = store.getItem(DEVICE_SESSION_STORAGE_KEY);

    const error = await createDeviceClient({
      supabaseUrl: SIN_RED,
      anonKey,
      sessionStore: store,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SinConexionError);
    expect(esSinConexion(error)).toBe(true);
    expect(store.getItem(DEVICE_SESSION_STORAGE_KEY)).toBe(antes);

    // Y en cuanto vuelve la red, esa misma sesión arranca sin re-emparejar.
    const client = await createDeviceClient({ supabaseUrl: url, anonKey, sessionStore: store });
    const { data } = await client.auth.getUser();
    expect(data.user?.email).toBe(email);
  }, 90_000);

  it("tampoco con el token de acceso ya caducado: no lo confunde con 'no hay sesión'", async () => {
    // El caso de un PC apagado unos días: el token de acceso caducó y, sin red, supabase-js no
    // puede renovarlo. `getSession()` devolvía entonces `session: null` y el agente decía "no hay
    // sesión guardada", con la sesión en disco.
    const { email, password } = await seedDeviceAccount();
    const store = memStore();
    await signInAndPersistSession(url, anonKey, store, email, password);
    const guardada = JSON.parse(store.getItem(DEVICE_SESSION_STORAGE_KEY) ?? "{}");
    guardada.expires_at = Math.floor(Date.now() / 1000) - 3600;
    store.setItem(DEVICE_SESSION_STORAGE_KEY, JSON.stringify(guardada));

    await expect(
      createDeviceClient({ supabaseUrl: SIN_RED, anonKey, sessionStore: store }),
    ).rejects.toBeInstanceOf(SinConexionError);
    expect(store.getItem(DEVICE_SESSION_STORAGE_KEY)).not.toBeNull();

    const client = await createDeviceClient({ supabaseUrl: url, anonKey, sessionStore: store });
    const { data } = await client.auth.getUser();
    expect(data.user?.email).toBe(email);
  }, 90_000);
});
