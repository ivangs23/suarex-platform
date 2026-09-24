import { getProducts, marcarAgotadoHoy, reponerProducto } from "@suarex/db";
import { describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
} from "./helpers/tenants.js";

/**
 * AGOTADO HOY.
 *
 * `is_available` ya existía pero es permanente: hay que acordarse de reactivar el plato y
 * nadie se acuerda. Esto lo separa en dos conceptos —fuera de carta (manual) y agotado hoy
 * (vuelve solo)— porque fundirlos haría que el restablecimiento automático devolviera a la
 * carta platos que el dueño había retirado a propósito.
 */
describe("marcarAgotadoHoy", () => {
  it("saca el producto de la carta", async () => {
    const f = await createTenantFixture(`ago-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "ago");
      expect((await getProducts(f.tenantId)).map((p) => p.id)).toContain(seed.productId);

      await marcarAgotadoHoy(f.tenantId, seed.productId);

      expect((await getProducts(f.tenantId)).map((p) => p.id)).not.toContain(seed.productId);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("vuelve solo cuando pasa la hora", async () => {
    // La razón de ser de la columna. Se simula adelantando el reloj: se pone la marca en el
    // pasado, que es donde estará mañana por la mañana.
    const f = await createTenantFixture(`vuelve-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "vuelve");
      await marcarAgotadoHoy(f.tenantId, seed.productId);
      await admin
        .from("products")
        .update({ unavailable_until: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", seed.productId);

      expect((await getProducts(f.tenantId)).map((p) => p.id)).toContain(seed.productId);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("apunta a la madrugada siguiente, no a medianoche", async () => {
    // Un bar abierto hasta las 2:00 que marca algo agotado a la 1:30 lo vería reaparecer
    // treinta minutos después, en pleno servicio.
    const f = await createTenantFixture(`hora-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "hora");
      const hasta = await marcarAgotadoHoy(f.tenantId, seed.productId);

      expect(new Date(hasta).getTime()).toBeGreaterThan(Date.now());
      // Menos de 31 h cubre el caso de marcarlo justo después de las 06:00.
      expect(new Date(hasta).getTime() - Date.now()).toBeLessThan(31 * 3600_000);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("NO se puede pedir un producto agotado", async () => {
    // La carta es solo la mitad: sin esto, un carrito abierto antes de agotarse seguiría
    // pudiendo enviar la comanda.
    const { createPendingOrder } = await import("@suarex/db");
    const f = await createTenantFixture(`pedir-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "pedir");
      const { data: mesa } = await admin
        .from("tables")
        .insert({ tenant_id: f.tenantId, venue_id: seed.venueId, label: `m-${nonce()}` })
        .select("id")
        .single();

      await marcarAgotadoHoy(f.tenantId, seed.productId);

      await expect(
        createPendingOrder({
          tenantId: f.tenantId,
          venueId: seed.venueId,
          tableId: mesa?.id as string,
          lines: [{ productId: seed.productId, quantity: 1, extraIds: [], notes: null }],
          taxRate: 0.1,
        }),
      ).rejects.toThrow();
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("reponer lo devuelve a la carta de inmediato", async () => {
    // Llegó género antes de lo previsto: el dueño no tiene que esperar a mañana.
    const f = await createTenantFixture(`repo-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "repo");
      await marcarAgotadoHoy(f.tenantId, seed.productId);
      await reponerProducto(f.tenantId, seed.productId);

      expect((await getProducts(f.tenantId)).map((p) => p.id)).toContain(seed.productId);
    } finally {
      await deleteTenantFixture(f);
    }
  });

  it("agotar hoy NO toca `is_available`: son cosas distintas", async () => {
    // Si las fundiera, reponer automáticamente devolvería a la carta platos que el dueño
    // había retirado a propósito.
    const f = await createTenantFixture(`sep-${nonce()}`);
    try {
      const seed = await seedCatalog(f.tenantId, "sep");
      await marcarAgotadoHoy(f.tenantId, seed.productId);

      const { data } = await admin
        .from("products")
        .select("is_available")
        .eq("id", seed.productId)
        .single();
      expect(data?.is_available).toBe(true);
    } finally {
      await deleteTenantFixture(f);
    }
  });
});
