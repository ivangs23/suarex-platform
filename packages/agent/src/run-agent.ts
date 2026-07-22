import { parseBranding } from "@suarex/config";
import type { PrintableOrder } from "@suarex/db";
import { deviceKey, enqueueByDevice, type PrinterConfig, printToPrinter } from "@suarex/printing";
import { buildTicketLines, type TicketBranding, type TicketOrder } from "@suarex/ticket";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AgentCredentials, createDeviceClient } from "./agent-client.js";
import { unprintedPaidOrdersForDevice } from "./device-orders.js";

const DEFAULT_POLL_MS = 4000;

export type AgentTickResult = { printed: number; failed: number };

type PrinterRow = {
  id: string;
  venue_id: string;
  destination: "cocina" | "barra" | "all";
  connection: { type?: string; host?: string; port?: number };
};

/** Cabecera del ticket a partir de la marca del tenant (nombre comercial), leída con el
 * JWT del device (la RLS le permite leer `tenant_settings`). Nunca lanza: si no hay marca,
 * la cabecera queda vacía. */
async function ticketBranding(client: SupabaseClient): Promise<TicketBranding> {
  const { data } = await client.from("tenant_settings").select("branding").maybeSingle();
  const name = parseBranding(data?.branding).name;
  return { header: name ?? "" };
}

/** Impresoras de RED habilitadas del tenant (las USB son C2b; se ignoran aquí). */
async function networkPrinters(client: SupabaseClient): Promise<PrinterRow[]> {
  const { data, error } = await client
    .from("printers")
    .select("id, venue_id, destination, connection")
    .eq("enabled", true);
  if (error) throw error;
  return (data as unknown as PrinterRow[]).filter((p) => p.connection?.type === "network");
}

function toTicketOrder(order: PrintableOrder): TicketOrder {
  return {
    orderNumber: order.orderNumber,
    tableLabel: order.tableLabel,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      destination: item.destination,
      extras: [],
    })),
  };
}

/**
 * UNA pasada del agente: lee los pedidos pendientes con el JWT del device, y por cada
 * pedido y cada impresora de RED de destino que aún no conste en `printedTargets`, entrega
 * el ticket y, SOLO si la entrega tuvo éxito, marca esa impresora vía `reserve_printed_self`
 * (RPC, JWT del device -- nunca el service role). Orden entregar→marcar (at-least-once): un
 * fallo entre ambos reimprime en el siguiente tick, nunca pierde el ticket. La marca es por
 * impresora, así que un pedido con una impresora ok y otra caída solo reintenta la caída.
 */
export async function runAgentTick(client: SupabaseClient): Promise<AgentTickResult> {
  const [orders, printers, branding] = await Promise.all([
    unprintedPaidOrdersForDevice(client),
    networkPrinters(client),
    ticketBranding(client),
  ]);

  let printed = 0;
  let failed = 0;

  for (const order of orders) {
    const ticketOrder = toTicketOrder(order);
    const neededDestinations = new Set(order.items.map((i) => i.destination));
    for (const printer of printers) {
      // Ceguera de venue (revisión final whole-branch, Finding 1): en un tenant con
      // varios locales, dos impresoras del MISMO `destination` en locales distintos son
      // "el mismo destino" a ojos del filtro de arriba, pero solo una de ellas es la del
      // local real del pedido. Sin esta comprobación, la impresora de OTRO local
      // imprimiría el ticket en silencio -- físicamente en el restaurante equivocado. El
      // camino de LECTURA (`targetPrinterIds`, `packages/db/src/print-jobs.ts`) ya filtra
      // por venue al decidir qué está cubierto; esta es la misma comprobación aplicada
      // aquí, en el camino de ENTREGA, que antes no la tenía.
      if (printer.venue_id !== order.venueId) continue;
      const dest = printer.destination;
      const applies = dest === "all" || neededDestinations.has(dest);
      if (!applies) continue;
      if (Object.hasOwn(order.printedTargets, printer.id)) continue;

      // `buildTicketLines` ya sabe qué hacer con "all": incluye TODOS los items del pedido
      // en un único ticket (en vez de filtrar por estación). Pasarle `dest` tal cual --sin
      // reducirlo a una sola estación-- es lo que evita que una impresora 'all' combinada
      // pierda en silencio los items de otra estación.
      const lines = buildTicketLines(ticketOrder, branding, dest);
      const config: PrinterConfig = {
        id: printer.id,
        label: printer.id,
        destination: dest,
        adapter: "escpos-tcp",
        host: printer.connection.host as string,
        port: printer.connection.port as number,
      };
      const result = await enqueueByDevice(deviceKey(config), () => printToPrinter(lines, config));
      if (result.ok) {
        const { error } = await client.rpc("reserve_printed_self", {
          p_order_id: order.id,
          p_printer_id: printer.id,
          p_at: new Date().toISOString(),
        });
        if (error) {
          // La entrega YA tuvo éxito; solo falló registrarlo. No hay pérdida de datos --
          // un pedido impreso-pero-no-marcado simplemente se reimprime en el siguiente tick
          // (el trade-off aceptado de at-least-once) -- pero un fallo puntual de esta RPC no
          // debe abortar el tick entero y dejar sin intentar el resto de impresoras/pedidos.
          console.error("[agent] fallo al marcar impreso:", error);
          failed += 1;
          continue;
        }
        printed += 1;
      } else {
        failed += 1;
      }
    }
  }

  // Heartbeat informativo: nunca derriba el tick. `client.rpc(...)` devuelve un
  // PostgrestBuilder que solo implementa `PromiseLike` (tiene `.then`, no `.catch`), así que
  // se envuelve en try/await/catch en vez de encadenar `.catch` directamente.
  try {
    await client.rpc("device_heartbeat", { p_app_version: null });
  } catch {
    // informativo: un fallo aquí no debe derribar el tick de impresión.
  }

  return { printed, failed };
}

/**
 * Arranca el agente: crea el cliente del dispositivo y sondea cada `pollMs`. Devuelve una
 * función para detenerlo (la usará la cáscara Electron de C2b al cerrarse). Un error en un
 * tick se registra pero no derriba el bucle -- el siguiente tick reintenta.
 */
export async function runAgent(
  creds: AgentCredentials,
  opts?: { pollMs?: number },
): Promise<() => void> {
  const client = await createDeviceClient(creds);
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // no solapar ticks
    running = true;
    try {
      await runAgentTick(client);
    } catch (error) {
      console.error("[agent] tick falló:", error);
    } finally {
      running = false;
    }
  }, pollMs);
  return () => clearInterval(timer);
}
