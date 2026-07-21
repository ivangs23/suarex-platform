import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

// Se deriva de TenantFixture["client"] (definido en ./helpers/tenants.ts) en vez de
// importar `RealtimeChannel` directamente desde "@supabase/supabase-js": la regla de lint
// `noRestrictedImports` (biome.json) reserva ese import a packages/db/src y
// tests/integration/helpers -- el resto del código, tests incluidos, debe consumir
// Supabase a través de esa capa, nunca importando el SDK crudo.
let tenantA: TenantFixture;
let tenantB: TenantFixture;
let channel: ReturnType<TenantFixture["client"]["channel"]>;
const received: { tenant_id: string }[] = [];

beforeAll(async () => {
  tenantA = await createTenantFixture(`rt-a-${nonce()}`);
  tenantB = await createTenantFixture(`rt-b-${nonce()}`);
  await seedCatalog(tenantA.tenantId, "a");
  await seedCatalog(tenantB.tenantId, "b");

  // El personal de A se suscribe con SU sesión autenticada.
  channel = tenantA.client
    .channel(`tenant:${tenantA.tenantId}:orders`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
      received.push(payload.new as { tenant_id: string });
    });

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error(`No se pudo suscribir: ${status}`));
      }
    });
  });
});

afterAll(async () => {
  await channel.unsubscribe();
  await deleteTenantFixture(tenantA);
  await deleteTenantFixture(tenantB);
});

describe("aislamiento de Realtime", () => {
  it("el personal de A NO recibe pedidos de B", async () => {
    // Control positivo primero: si A no recibe NADA, el test no prueba nada.
    await insertOrder(tenantA.tenantId);
    await insertOrder(tenantB.tenantId);
    await waitFor(3000);

    const fromA = received.filter((r) => r.tenant_id === tenantA.tenantId);
    const fromB = received.filter((r) => r.tenant_id === tenantB.tenantId);

    expect(
      fromA.length,
      "A no recibió su propio pedido: la suscripción no funciona",
    ).toBeGreaterThan(0);
    expect(fromB, "FUGA: A recibió un pedido de B por Realtime").toHaveLength(0);
  });
});

async function insertOrder(tenantId: string): Promise<void> {
  const { data: venue } = await admin
    .from("venues")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .single();

  const { error } = await admin.from("orders").insert({
    tenant_id: tenantId,
    venue_id: venue?.id,
    order_number: 1,
  });
  if (error) throw error;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
