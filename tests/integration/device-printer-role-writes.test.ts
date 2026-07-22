import { beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  nonce,
  signInAs,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * D2 tarea 1: cierra el hueco heredado del canal QR. Las policies de escritura de
 * `devices`/`printers` (creadas en 20260722000005_device_rls_hardening.sql) solo
 * excluían al rol `device`, así que un `staff` podía crear/borrar dispositivos e
 * impresoras -- gestionar la infraestructura del local es cosa de owner/admin, igual
 * que el catálogo (20260722000006_role_write_policies.sql, D1 tarea 1). La LECTURA no
 * cambia: staff y device siguen leyendo impresoras (device las necesita para construir
 * tickets); staff/owner/admin siguen viendo dispositivos.
 */

let tenant: TenantFixture; // owner
let staff: Awaited<ReturnType<typeof signInAs>>;
let venueId: string;

beforeAll(async () => {
  tenant = await createTenantFixture(`dpw-${nonce()}`);
  staff = await signInAs(tenant.tenantId, "staff");
  const { data: venue } = await admin
    .from("venues")
    .insert({ tenant_id: tenant.tenantId, slug: `v-${nonce()}`, name: "V", is_default: false })
    .select("id")
    .single();
  venueId = venue?.id as string;
});

describe("escritura de dispositivos/impresoras por rol", () => {
  it("un owner PUEDE crear un dispositivo", async () => {
    const { error } = await tenant.client
      .from("devices")
      .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Agente" });
    expect(error).toBeNull();
  });

  it("un staff NO puede crear un dispositivo", async () => {
    const { error } = await staff
      .from("devices")
      .insert({ tenant_id: tenant.tenantId, venue_id: venueId, name: "Intento" });
    expect(error?.code).toBe("42501");
  });

  it("un owner PUEDE crear una impresora", async () => {
    const { error } = await tenant.client.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Cocina",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
    });
    expect(error).toBeNull();
  });

  it("un staff NO puede crear una impresora", async () => {
    const { error } = await staff.from("printers").insert({
      tenant_id: tenant.tenantId,
      venue_id: venueId,
      name: "Intento",
      connection: { type: "network", host: "127.0.0.1", port: 9100 },
    });
    expect(error?.code).toBe("42501");
  });

  it("REGRESIÓN: un staff SIGUE pudiendo leer las impresoras (para el panel de comandas / device)", async () => {
    const { error } = await staff.from("printers").select("id").limit(1);
    expect(error).toBeNull();
  });
});
