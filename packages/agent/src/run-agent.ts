import { parseBranding } from "@suarex/config";
import type { PrintableOrder } from "@suarex/db";
import { deviceKey, enqueueByDevice, type PrinterConfig, printToPrinter } from "@suarex/printing";
import { buildTicketLines, type TicketBranding, type TicketOrder } from "@suarex/ticket";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AgentCredentials, createDeviceClient } from "./agent-client.js";
import { unprintedPaidOrdersForDevice } from "./device-orders.js";

const DEFAULT_POLL_MS = 4000;

/** Una entrega de ticket que falló, con lo justo para avisar de qué impresora cayó. */
export type PrintFailure = {
  printerId: string;
  orderNumber: number;
  destination: "cocina" | "barra" | "all";
  reason: string;
};

export type AgentTickResult = {
  printed: number;
  failed: number;
  /** Ids de las impresoras que entregaron OK en este tick. Sirve para detectar que una
   *  impresora que estaba caída ha vuelto (y retirar su aviso), no solo cuándo cae. */
  succeeded: string[];
  /** Solo los fallos de ENTREGA (impresora inalcanzable), para avisar de una impresora
   *  caída. No incluye el fallo transitorio de marcar impreso (se reintenta sin perder nada). */
  failures: PrintFailure[];
  /** Presente solo si el tick entero reventó (p. ej. la lectura de pedidos): sin él, un fallo
   *  de red dejaría la UI diciendo "imprimiendo" con la cocina muda y sin explicación. */
  error?: string;
};

type PrinterRowDb = {
  id: string;
  venue_id: string;
  device_id: string | null;
  destination: "cocina" | "barra" | "all";
  connection: { type?: string; host?: string; port?: number; printerName?: string };
};

type ResolvedPrinter = {
  id: string;
  venueId: string;
  destination: "cocina" | "barra" | "all";
  config: PrinterConfig;
};

/** Cabecera del ticket a partir de la marca del tenant (nombre comercial), leída con el
 * JWT del device (la RLS le permite leer `tenant_settings`). Nunca lanza: si no hay marca,
 * la cabecera queda vacía. */
async function ticketBranding(client: SupabaseClient): Promise<TicketBranding> {
  const { data } = await client.from("tenant_settings").select("branding").maybeSingle();
  const name = parseBranding(data?.branding).name;
  return { header: name ?? "" };
}

/** Impresora id del PROPIO dispositivo del agente, leída con su JWT (`devices_select_own`
 * devuelve solo la fila cuyo `auth_user_id = auth.uid()`). `null` si no hay fila (p. ej. un
 * device sembrado sin fila en `devices`): entonces no se reclama ninguna USB. */
async function ownDeviceId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.from("devices").select("id").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Impresoras habilitadas que este agente puede imprimir, con su `PrinterConfig` ya
 * construida por tipo:
 *   - RED (`connection.type === "network"`): cualquier agente del tenant la alcanza; el
 *     acotado por local (`venue_id`) lo aplica el bucle de impresión (igual que antes).
 *   - USB (`connection.type === "usb"`): SOLO si `device_id` es el propio dispositivo -- una
 *     impresora USB está físicamente en ESTE PC, así que ningún otro agente debe reclamarla.
 * Un tipo desconocido, o una USB de otro device, se ignora.
 */
async function resolvePrinters(client: SupabaseClient): Promise<ResolvedPrinter[]> {
  const deviceId = await ownDeviceId(client);
  const { data, error } = await client
    .from("printers")
    .select("id, venue_id, device_id, destination, connection")
    .eq("enabled", true);
  if (error) throw error;

  const resolved: ResolvedPrinter[] = [];
  for (const p of data as unknown as PrinterRowDb[]) {
    const conn = p.connection ?? {};
    if (conn.type === "network") {
      resolved.push({
        id: p.id,
        venueId: p.venue_id,
        destination: p.destination,
        config: {
          adapter: "escpos-tcp",
          id: p.id,
          label: p.id,
          destination: p.destination,
          host: conn.host as string,
          port: conn.port as number,
        },
      });
    } else if (conn.type === "usb" && deviceId !== null && p.device_id === deviceId) {
      resolved.push({
        id: p.id,
        venueId: p.venue_id,
        destination: p.destination,
        config: {
          adapter: "escpos-usb",
          id: p.id,
          label: p.id,
          destination: p.destination,
          printerName: conn.printerName as string,
        },
      });
    }
  }
  return resolved;
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
    resolvePrinters(client),
    ticketBranding(client),
  ]);

  let printed = 0;
  let failed = 0;
  const failures: PrintFailure[] = [];
  const succeeded = new Set<string>();

  for (const order of orders) {
    const ticketOrder = toTicketOrder(order);
    const neededDestinations = new Set(order.items.map((i) => i.destination));
    for (const printer of printers) {
      // Acotado por local (venue) para TODAS las impresoras (red y USB): un pedido solo se
      // imprime en las impresoras de su propio local (ver Finding 1 de C2a).
      if (printer.venueId !== order.venueId) continue;
      const dest = printer.destination;
      const applies = dest === "all" || neededDestinations.has(dest);
      if (!applies) continue;
      if (Object.hasOwn(order.printedTargets, printer.id)) continue;

      const lines = buildTicketLines(ticketOrder, branding, dest);
      const result = await enqueueByDevice(deviceKey(printer.config), () =>
        printToPrinter(lines, printer.config),
      );
      if (result.ok) {
        // La entrega funcionó -> la impresora está viva, aunque luego falle marcarla. Cuenta
        // como "recuperada" para retirar un aviso previo de impresora caída.
        succeeded.add(printer.id);
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
        failures.push({
          printerId: printer.id,
          orderNumber: order.orderNumber,
          destination: dest,
          reason: result.reason ?? "impresora inalcanzable",
        });
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

  return { printed, failed, succeeded: [...succeeded], failures };
}

/**
 * Arranca el agente: crea el cliente del dispositivo y sondea cada `pollMs`. Devuelve una
 * función para detenerlo (la usará la cáscara Electron de C2b al cerrarse). Un error en un
 * tick se registra pero no derriba el bucle -- el siguiente tick reintenta.
 */
export async function runAgent(
  creds: AgentCredentials,
  opts?: {
    pollMs?: number;
    /** Se llama tras CADA tick con su resultado -- la cáscara Electron lo usa para dar
     *  visibilidad (cuántos impresos, qué impresora cayó) en vez de ser una caja negra. Un
     *  tick que revienta llega aquí con `error` puesto, nunca se traga en silencio. */
    onTick?: (result: AgentTickResult) => void;
  },
): Promise<() => void> {
  const client = await createDeviceClient(creds);
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; // no solapar ticks
    running = true;
    try {
      const result = await runAgentTick(client);
      opts?.onTick?.(result);
    } catch (error) {
      console.error("[agent] tick falló:", error);
      opts?.onTick?.({
        printed: 0,
        failed: 0,
        succeeded: [],
        failures: [],
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
    }
  }, pollMs);
  return () => clearInterval(timer);
}
