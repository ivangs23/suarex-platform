import { purgeOrderPersonalData } from "@suarex/db";
import { describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
} from "./helpers/tenants.js";

/**
 * La política de privacidad promete borrar las notas a los 90 días y el pedido a los 24 meses
 * (ver `apps/web/lib/legal-content.ts`, cuyo test ata esos números). Una promesa que nadie
 * ejecuta es peor que no hacerla: esto comprueba que se ejecuta de verdad.
 */
describe("purgeOrderPersonalData", () => {
  it("anula las notas viejas y CONSERVA la línea de venta", async () => {
    const fixture = await createTenantFixture(`purga-${nonce()}`);
    try {
      const seed = await seedCatalog(fixture.tenantId, "purga");

      // Envejecer el pedido 200 días: por encima de los 90 de las notas, por debajo de los
      // 24 meses del borrado completo. Así se prueba que los dos plazos son independientes.
      await admin
        .from("orders")
        .update({ created_at: new Date(Date.now() - 200 * 86400_000).toISOString() })
        .eq("id", seed.orderId);
      await admin
        .from("order_items")
        .update({ notes: "para la alérgica" })
        .eq("id", seed.orderItemId);

      await purgeOrderPersonalData();

      const { data } = await admin
        .from("order_items")
        .select("id, notes")
        .eq("id", seed.orderItemId)
        .maybeSingle();

      expect(data?.notes, "la nota debía anularse a los 90 días").toBeNull();
      expect(data?.id, "la línea de venta NO se borra: el restaurante la necesita").toBe(
        seed.orderItemId,
      );
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("no toca las notas recientes", async () => {
    // El pedido de hoy tiene que conservar su nota: la cocina la necesita.
    const fixture = await createTenantFixture(`reciente-${nonce()}`);
    try {
      const seed = await seedCatalog(fixture.tenantId, "reciente");
      await admin.from("order_items").update({ notes: "sin cebolla" }).eq("id", seed.orderItemId);

      await purgeOrderPersonalData();

      const { data } = await admin
        .from("order_items")
        .select("notes")
        .eq("id", seed.orderItemId)
        .maybeSingle();
      expect(data?.notes).toBe("sin cebolla");
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("borra el pedido entero pasados los 24 meses", async () => {
    const fixture = await createTenantFixture(`viejo-${nonce()}`);
    try {
      const seed = await seedCatalog(fixture.tenantId, "viejo");
      await admin
        .from("orders")
        .update({ created_at: new Date(Date.now() - 800 * 86400_000).toISOString() })
        .eq("id", seed.orderId);

      await purgeOrderPersonalData();

      const { data } = await admin.from("orders").select("id").eq("id", seed.orderId).maybeSingle();
      expect(data, "un pedido de hace más de 24 meses debe desaparecer").toBeNull();
    } finally {
      await deleteTenantFixture(fixture);
    }
  });

  it("rechaza un plazo no positivo en vez de barrerlo todo", async () => {
    // Un 0 por descuido en el cron borraría el historial de todos los clientes de una pasada.
    // Falla cerrado.
    await expect(purgeOrderPersonalData(0, 24)).rejects.toThrow(/positivos/);
    await expect(purgeOrderPersonalData(90, -1)).rejects.toThrow(/positivos/);
  });
});
