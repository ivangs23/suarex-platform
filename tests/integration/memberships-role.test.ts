import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantFixture } from "./helpers/tenants.js";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

let fixture: TenantFixture;

afterAll(async () => {
  if (fixture) await deleteTenantFixture(fixture);
});

beforeAll(async () => {
  fixture = await createTenantFixture(`mem-${nonce()}`);
});

describe("memberships", () => {
  it("un usuario ve su propia membresía", async () => {
    const { data, error } = await fixture.client.from("memberships").select("role, tenant_id");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.tenant_id).toBe(fixture.tenantId);
  });

  it("NO puede ascenderse a owner", async () => {
    const { error } = await fixture.client
      .from("memberships")
      .update({ role: "owner" })
      .eq("tenant_id", fixture.tenantId);

    // Debe ser un rechazo de permisos, no un update silencioso de 0 filas.
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");

    const { data } = await admin
      .from("memberships")
      .select("role")
      .eq("tenant_id", fixture.tenantId)
      .single();
    expect(data?.role).toBe("owner");
  });

  it("NO puede insertar una membresía nueva", async () => {
    const { error } = await fixture.client.from("memberships").insert({
      tenant_id: fixture.tenantId,
      user_id: fixture.userId,
      role: "admin",
    });
    expect(error?.code).toBe("42501");
  });

  it("NO puede borrar su membresía", async () => {
    const { error } = await fixture.client
      .from("memberships")
      .delete()
      .eq("tenant_id", fixture.tenantId);
    expect(error?.code).toBe("42501");
  });
});
