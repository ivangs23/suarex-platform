import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveStaffSession } from "../../apps/web/lib/staff-session.js";
import type { ResolvedTenant } from "../../apps/web/lib/tenant-context.js";
import {
  admin,
  anonClient,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * Cubre el fail-closed de `resolveStaffSession` -- la única función de
 * autorización de la superficie de personal (ver su docstring en
 * `apps/web/lib/staff-session.ts`) -- contra el servidor de Auth REAL del
 * stack local, nunca mockeado: la garantía que importa (rechazar una firma
 * inválida) solo la puede dar una verificación criptográfica real.
 *
 * `resolveStaffSession` acepta un `jwt` explícito (tercer parámetro, el mismo
 * que expone `client.auth.getClaims(jwt?)`) precisamente para poder pasarle
 * aquí un token real, con o sin manipular, sin depender de cookies ni de
 * `next/headers` -- eso es lo que hace posible testear esta función fuera de
 * un request de Next.js.
 */

const PASSWORD = "fixture-password-1234";

/** Usuario de Auth real, con sesión real, pero SIN ninguna fila en `memberships`:
 * `custom_access_token_hook` no encuentra membership y no añade `tenant_id` al
 * token, así que su JWT tiene firma válida pero ningún claim de tenant. */
async function createUserWithoutMembership() {
  const email = `no-membership-${nonce()}@fixture.local`;
  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError) throw userError;

  const { data: signIn, error: signInError } = await anonClient().auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError) throw signInError;

  return { userId: user.user.id, accessToken: signIn.session.access_token };
}

function b64urlDecode(segment: string): string {
  return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
function b64urlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Toma un JWT real, válido, y le cambia el claim `tenant_id` sin volver a
 * firmarlo -- exactamente lo que haría un atacante editando una cookie sin
 * conocer la clave de firma. La firma original queda intacta pero ya no
 * corresponde al payload alterado. */
function forgeTenantClaim(realToken: string, forgedTenantId: string): string {
  const [header, payload, signature] = realToken.split(".");
  if (!header || !payload || !signature) throw new Error("Token real con formato inesperado");

  const claims = JSON.parse(b64urlDecode(payload)) as Record<string, unknown>;
  claims.tenant_id = forgedTenantId;
  const forgedPayload = b64urlEncode(JSON.stringify(claims));

  return `${header}.${forgedPayload}.${signature}`;
}

function tenantOf(fixture: TenantFixture): ResolvedTenant {
  return { id: fixture.tenantId, slug: fixture.slug };
}

describe("resolveStaffSession — fail-closed", () => {
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  beforeAll(async () => {
    tenantA = await createTenantFixture(`staff-a-${nonce()}`);
    tenantB = await createTenantFixture(`staff-b-${nonce()}`);
  });

  afterAll(async () => {
    for (const fixture of [tenantA, tenantB]) {
      if (fixture) await deleteTenantFixture(fixture);
    }
  });

  it("sin sesión en absoluto -> null", async () => {
    const result = await resolveStaffSession(anonClient(), tenantOf(tenantA));
    expect(result).toBeNull();
  });

  it("token con firma válida pero sin claim tenant_id (cuenta sin membership) -> null", async () => {
    const { accessToken } = await createUserWithoutMembership();
    const result = await resolveStaffSession(anonClient(), tenantOf(tenantA), accessToken);
    expect(result).toBeNull();
  });

  it("token forjado/alterado (firma ya no coincide con el payload) -> null", async () => {
    const realToken = (await tenantA.client.auth.getSession()).data.session?.access_token;
    if (!realToken) throw new Error("La fixture de tenantA no tiene sesión activa");

    const forged = forgeTenantClaim(realToken, tenantB.tenantId);
    const result = await resolveStaffSession(anonClient(), tenantOf(tenantB), forged);
    expect(result).toBeNull();
  });

  it("mismatch de tenant: sesión válida de A usada contra el Host de B -> null", async () => {
    const realToken = (await tenantA.client.auth.getSession()).data.session?.access_token;
    if (!realToken) throw new Error("La fixture de tenantA no tiene sesión activa");

    const result = await resolveStaffSession(anonClient(), tenantOf(tenantB), realToken);
    expect(result).toBeNull();
  });

  it("control positivo: sesión válida de A usada contra el Host de A -> sesión concedida", async () => {
    const realToken = (await tenantA.client.auth.getSession()).data.session?.access_token;
    if (!realToken) throw new Error("La fixture de tenantA no tiene sesión activa");

    const result = await resolveStaffSession(anonClient(), tenantOf(tenantA), realToken);
    expect(result).toEqual({ userId: tenantA.userId, tenantId: tenantA.tenantId });
  });
});
