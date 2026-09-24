import { getCategories } from "@suarex/db";
import { describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
} from "./helpers/tenants.js";

/**
 * FRANJAS HORARIAS DE CARTA: la parte que solo se puede comprobar contra la base -- que la
 * columna existe, que el CHECK rechaza media franja y que `getCategories` filtra de verdad.
 * Las horas frontera y la franja que cruza medianoche van en `packages/db/src/franjas.test.ts`,
 * donde se pueden probar sin esperar a que den las 20:00.
 */
describe("getCategories con franjas", () => {
  it("oculta la categoría fuera de su franja", async () => {
    const f = await createTenantFixture(`franja-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "franja");
      // Una franja que no puede contener el momento actual: de 03:00 a 03:01.
      await admin
        .from("categories")
        .update({ visible_desde: "03:00", visible_hasta: "03:01" })
        .eq("id", seed.categoryId);

      const ids = (await getCategories(f.tenantId)).map((c) => c.id);
      // Solo se comprueba si AHORA no son las 03:00-03:01; en ese minuto el test no aplica.
      const ahora = new Date();
      if (!(ahora.getHours() === 3 && ahora.getMinutes() === 0)) {
        expect(ids).not.toContain(seed.categoryId);
      }
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("una categoría sin franja se ve siempre", async () => {
    const f = await createTenantFixture(`sinfr-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "sinfr");
      const ids = (await getCategories(f.tenantId)).map((c) => c.id);
      expect(ids).toContain(seed.categoryId);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("no se puede guardar media franja", async () => {
    // Media franja produciría una carta que aparece y no desaparece, sin que nadie entienda
    // por qué.
    const f = await createTenantFixture(`media-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "media");
      const { error } = await admin
        .from("categories")
        .update({ visible_desde: "08:00" })
        .eq("id", seed.categoryId);
      expect(error, "el CHECK debía rechazarlo").not.toBeNull();
    } finally {
      await deleteTenantFixture(f);
    }
  });
});

describe("pedir fuera de la franja", () => {
  it("NO se puede pedir un producto de una categoría fuera de su horario", async () => {
    // La carta es solo la mitad. Un carrito abierto a las 15:50 seguiría pudiendo mandar la
    // comanda de mediodía a las 16:05, y cocina recibiría algo que ya no se hace. Mismo
    // agujero que tapó el guard de "agotado hoy".
    const { createPendingOrder } = await import("@suarex/db");
    const f = await createTenantFixture(`fpedir-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "fpedir");
      const { data: mesa } = await admin
        .from("tables")
        .insert({ tenant_id: f.tenantId, venue_id: seed.venueId, label: `m-${nonce()}` })
        .select("id")
        .single();

      const pedir = () =>
        createPendingOrder({
          tenantId: f.tenantId,
          venueId: seed.venueId,
          tableId: mesa?.id as string,
          lines: [{ productId: seed.productId, quantity: 1, extraIds: [], notes: null }],
          taxRate: 0.1,
        });

      // Dentro de horario sí, para no dar por buena una prohibición que en realidad sería un
      // fallo de otra cosa.
      const dentro = await pedir();
      expect(dentro.orderId).toBeTruthy();

      // Una franja de una hora que empieza dentro de dos: nunca es ahora, den las horas que den.
      const hora = new Date().getHours();
      const dosDigitos = (h: number) => String(h % 24).padStart(2, "0");
      await admin
        .from("categories")
        .update({
          visible_desde: `${dosDigitos(hora + 2)}:00`,
          visible_hasta: `${dosDigitos(hora + 3)}:00`,
        })
        .eq("id", seed.categoryId);

      await expect(pedir()).rejects.toThrow();
    } finally {
      await deleteTenantFixture(f);
    }
  });
});
