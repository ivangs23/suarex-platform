import { isPlatformAdmin } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { admin, createTenantFixture, deleteTenantFixture, nonce } from "./helpers/tenants.js";

/**
 * LA SEGUNDA FRONTERA DE SEGURIDAD: quién es del equipo de SuarEx.
 *
 * `platform_admins` es tabla aparte de `memberships` a propósito (ver la migración). Lo que se
 * prueba aquí es lo que hace que esa separación valga de algo: que la tabla sea INALCANZABLE
 * desde una sesión de cliente, en lectura y en escritura. Si un owner pudiera añadirse, tomar
 * una sola cuenta de restaurante comprometería la plataforma entera.
 *
 * Ojo: `tenant-isolation.test.ts` NO cubre esta tabla. Esa suite itera lo que devuelve
 * `list_tenant_scoped_tables()`, que solo lista tablas con columna `tenant_id`, y
 * `platform_admins` no la tiene. Si estos tests no existen, nadie la vigila.
 */
describe("platform_admins", () => {
  it("un usuario de tenant no es superadmin", async () => {
    const fixture = await createTenantFixture(`noadmin-${nonce()}`);
    try {
      expect(await isPlatformAdmin(fixture.userId)).toBe(false);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("reconoce a quien sí está en la tabla", async () => {
    const email = `super-${nonce()}@suarex.local`;
    const { data: user } = await admin.auth.admin.createUser({
      email,
      password: `pw-${nonce()}-Aa1`,
      email_confirm: true,
    });
    const userId = user.user?.id as string;
    try {
      await admin.from("platform_admins").insert({ user_id: userId, email });
      expect(await isPlatformAdmin(userId)).toBe(true);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("un owner autenticado NO puede leer la tabla", async () => {
    // Ni siquiera enumerar quién es superadmin: eso ya sería un mapa de a quién atacar.
    const fixture = await createTenantFixture(`rls-lee-${nonce()}`);
    try {
      const { data } = await fixture.client.from("platform_admins").select("user_id");
      expect(data ?? []).toHaveLength(0);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("un owner autenticado NO puede añadirse como superadmin", async () => {
    // La prueba que justifica la tabla entera: comprometer una cuenta de restaurante no puede
    // convertirse en comprometer la plataforma.
    const fixture = await createTenantFixture(`rls-escribe-${nonce()}`);
    try {
      const { error } = await fixture.client
        .from("platform_admins")
        .insert({ user_id: fixture.userId, email: fixture.email });
      expect(error, "un owner NO puede añadirse como superadmin").not.toBeNull();

      // Y de verdad no se escribió, no solo devolvió error.
      const { data } = await admin
        .from("platform_admins")
        .select("user_id")
        .eq("user_id", fixture.userId);
      expect(data ?? []).toHaveLength(0);
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("borrar la cuenta de Auth se lleva la fila de superadmin", async () => {
    // `on delete cascade`: dar de baja a alguien del equipo no puede dejar una fila huérfana
    // que un futuro `user_id` reutilizado heredase.
    const email = `baja-${nonce()}@suarex.local`;
    const { data: user } = await admin.auth.admin.createUser({
      email,
      password: `pw-${nonce()}-Aa1`,
      email_confirm: true,
    });
    const userId = user.user?.id as string;
    await admin.from("platform_admins").insert({ user_id: userId, email });

    await admin.auth.admin.deleteUser(userId);

    const { data } = await admin.from("platform_admins").select("user_id").eq("user_id", userId);
    expect(data ?? []).toHaveLength(0);
  });
});
