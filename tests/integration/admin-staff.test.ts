import { createStaff, listStaff } from "@suarex/db";
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
const createdUserIds: string[] = [];

beforeAll(async () => {
  tenant = await createTenantFixture(`staff-${nonce()}`);
});

afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  if (tenant) await deleteTenantFixture(tenant);
});

describe("createStaff", () => {
  it("crea un usuario que inicia sesión y cuyo JWT lleva tenant_role=staff y el tenant correcto", async () => {
    const email = `camarero-${nonce()}@fixture.local`;
    const result = await createStaff(tenant.tenantId, { email, password: "clave-secreta-1234" });
    createdUserIds.push(result.userId);
    expect(result.email).toBe(email);

    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({
      email,
      password: "clave-secreta-1234",
    });
    expect(error).toBeNull();
    const { data } = await client.auth.getClaims();
    expect(data?.claims?.tenant_id).toBe(tenant.tenantId);
    expect(data?.claims?.tenant_role).toBe("staff");
  });

  it("crea exactamente una membership para ese usuario en ese tenant", async () => {
    const email = `camarero2-${nonce()}@fixture.local`;
    const result = await createStaff(tenant.tenantId, { email, password: "clave-secreta-1234" });
    createdUserIds.push(result.userId);

    const { data } = await admin
      .from("memberships")
      .select("role")
      .eq("user_id", result.userId)
      .eq("tenant_id", tenant.tenantId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.role).toBe("staff");
  });

  it("un email duplicado lanza y no crea un segundo usuario", async () => {
    const email = `dup-${nonce()}@fixture.local`;
    const first = await createStaff(tenant.tenantId, { email, password: "clave-secreta-1234" });
    createdUserIds.push(first.userId);

    await expect(
      createStaff(tenant.tenantId, { email, password: "otra-clave-5678" }),
    ).rejects.toThrow();

    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const matches = (usersPage?.users ?? []).filter((u) => u.email === email);
    expect(matches).toHaveLength(1);
  });
});

describe("listStaff", () => {
  it("devuelve las membership humanas del tenant con su email, no las de otro tenant", async () => {
    const other = await createTenantFixture(`staff-other-${nonce()}`);
    try {
      const email = `listado-${nonce()}@fixture.local`;
      const created = await createStaff(tenant.tenantId, { email, password: "clave-secreta-1234" });
      createdUserIds.push(created.userId);

      const rows = await listStaff(tenant.tenantId);
      const emails = rows.map((r) => r.email);
      expect(emails).toContain(email);
      // El owner de la fixture (createTenantFixture) también es una membership humana.
      expect(emails).toContain(tenant.email);
      // Ninguna fila del otro tenant.
      expect(emails).not.toContain(other.email);
    } finally {
      await deleteTenantFixture(other);
    }
  });
});
