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
const received: { id: string; tenant_id: string }[] = [];

// Justo tras `supabase db reset`, el canal reporta SUBSCRIBED antes de que el
// consumidor WAL de Realtime esté realmente entregando eventos: durante unos
// segundos no llega NADA, ni siquiera los pedidos propios de A. Estas constantes
// acotan la espera de calentamiento (ver waitForRealtimeReady más abajo).
const REALTIME_READY_TIMEOUT_MS = 20_000;
const REALTIME_READY_POLL_MS = 500;

beforeAll(async () => {
  tenantA = await createTenantFixture(`rt-a-${nonce()}`);
  tenantB = await createTenantFixture(`rt-b-${nonce()}`);
  await seedCatalog(tenantA.tenantId, "a");
  await seedCatalog(tenantB.tenantId, "b");

  // El personal de A se suscribe con SU sesión autenticada.
  channel = tenantA.client
    .channel(`tenant:${tenantA.tenantId}:orders`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders" }, (payload) => {
      received.push(payload.new as { id: string; tenant_id: string });
    });

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error(`No se pudo suscribir: ${status}`));
      }
    });
  });

  // No medir nada todavía: primero probar que Realtime entrega eventos de verdad.
  await waitForRealtimeReady(tenantA.tenantId);
}, REALTIME_READY_TIMEOUT_MS + 15_000);

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

/** Inserta un pedido y devuelve su id (usado tanto por el test como por la sonda de arranque). */
async function insertOrder(tenantId: string): Promise<string> {
  const { data: venue } = await admin
    .from("venues")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .single();

  const { data, error } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      venue_id: venue?.id,
      order_number: 1,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sonda de disponibilidad: inserta pedidos desechables de A, uno por intento, y
 * reintenta con backoff acotado hasta ver llegar CUALQUIERA de ellos por el
 * canal ya suscrito. Solo entonces se puede confiar en que "A no recibió nada"
 * significa una fuga o un fallo real, y no un consumidor WAL de Realtime que
 * todavía no ha calentado.
 *
 * Importante: cada intento inserta una fila NUEVA en vez de reutilizar la
 * primera. El insert que se hace justo tras el `phx_reply "ok"` de suscripción
 * puede caer en una ventana de arranque en frío en la que el poller WAL de
 * Realtime aún no ha completado su primer ciclo para esta suscripción -- ese
 * evento concreto se pierde para siempre (el WAL no se re-emite), así que
 * insistir sobre el mismo probeId esperaría indefinidamente sin motivo. Un
 * probe nuevo por intento le da a cada ciclo del poller una fila fresca que
 * emparejar, igual que ocurre de forma natural con los pedidos reales del test
 * (que nunca dependen de ser el primer insert tras el join).
 *
 * Si el bound se agota sin que llegue ningún evento, el error deja explícito
 * que es un problema de PREPARACIÓN/INFRAESTRUCTURA, no de aislamiento -- para
 * que nadie lo confunda con una fuga cross-tenant ni "arregle" el test
 * aflojando el aserto real.
 */
async function waitForRealtimeReady(tenantId: string): Promise<void> {
  const probeIds: string[] = [];
  try {
    const deadline = Date.now() + REALTIME_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const probeId = await insertOrder(tenantId);
      probeIds.push(probeId);
      const attemptDeadline = Math.min(Date.now() + REALTIME_READY_POLL_MS, deadline);
      while (Date.now() < attemptDeadline) {
        if (received.some((r) => probeIds.includes(r.id))) return;
        await waitFor(50);
      }
    }
    throw new Error(
      `[PREPARACIÓN, no aislamiento] Realtime no entregó ningún evento en ` +
        `${REALTIME_READY_TIMEOUT_MS}ms tras SUBSCRIBED (${probeIds.length} sondas de A, ` +
        `última orders.id=${probeIds.at(-1)}). ` +
        "Esto es un problema de infraestructura -- el consumidor WAL de Realtime no ha " +
        "terminado de calentar (típico justo tras `supabase db reset`) -- y NO indica una " +
        "fuga cross-tenant. No se ha ejecutado ninguna aserción de aislamiento todavía.",
    );
  } finally {
    // No dejar residuo: ninguna fila de sonda pertenece a ninguna aserción.
    // No relanzar aquí ("unsafe finally"): si esto falla, no debe enmascarar
    // ni el éxito ni el error de disponibilidad decididos arriba.
    if (probeIds.length > 0) {
      const { error } = await admin.from("orders").delete().in("id", probeIds);
      if (error) console.error(`No se pudieron borrar las filas de sonda ${probeIds}:`, error);
    }
    // Limpia lo que la sonda haya empujado a `received` para que las mediciones
    // reales del test empiecen desde cero.
    received.length = 0;
  }
}
