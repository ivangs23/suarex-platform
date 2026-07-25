import { parseBranding } from "@suarex/config";
import { type PrintableOrder, selectUnprintedOrders } from "@suarex/db";
import { pickupCodeFromToken, taxBreakdown } from "@suarex/domain";
import {
  aggregateStatus,
  createPrinterHealth,
  deviceKey,
  enqueueByDevice,
  type PrinterConfig,
  type PrinterHealth,
  type PrinterStatus,
  printToPrinter,
  probeTcp,
  stillFresh,
} from "@suarex/printing";
import { subscribeToOrders } from "@suarex/realtime";
import {
  buildReceiptLines,
  buildTicketLines,
  type ReceiptOrder,
  type TicketBranding,
  type TicketOrder,
} from "@suarex/ticket";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type AgentCredentials, createDeviceClient } from "./agent-client.js";
import { paidUnprintedOrderRows } from "./device-orders.js";

const DEFAULT_POLL_MS = 4000;

/** Una impresora que no responde, con lo justo para avisar de cuál es. */
export type PrintFailure = {
  printerId: string;
  /** El pedido que se quedó sin imprimir, o `null` si el fallo lo destapó una SONDA y no una
   *  entrega: una impresora apagada de madrugada no tiene ningún pedido asociado, y esperar a
   *  que lo tenga es esperar a que un cliente pague por descubrirlo. */
  orderNumber: number | null;
  destination: "cocina" | "barra" | "all" | "recibo";
  reason: string;
};

export type AgentTickResult = {
  printed: number;
  failed: number;
  /** Ids de las impresoras que en este tick se sabe VIVAS, por entrega o por sonda. Sirve para
   *  detectar que una impresora que estaba caída ha vuelto (y retirar su aviso), no solo cuándo
   *  cae -- y por la sonda eso se nota aunque no haya ningún pedido que imprimir. */
  succeeded: string[];
  /** Solo los fallos de ENTREGA (impresora inalcanzable), para avisar de una impresora
   *  caída. No incluye el fallo transitorio de marcar impreso (se reintenta sin perder nada). */
  failures: PrintFailure[];
  /** Presente solo si el tick entero reventó (p. ej. la lectura de pedidos): sin él, un fallo
   *  de red dejaría la UI diciendo "imprimiendo" con la cocina muda y sin explicación. */
  error?: string;
  /**
   * Estado de la impresora de RECIBOS de este dispositivo al cerrar el tick (#15). Lo consulta
   * el totem ANTES de cobrar: si sale `down`, el cliente se entera de que no habrá papel
   * mientras todavía puede apuntar su código, y no después de pagar.
   *
   * `unknown` cuando este dispositivo no tiene ninguna impresora de recibos configurada (que no
   * es una avería) o cuando aún no hay evidencia de ninguna.
   */
  receiptStatus: PrinterStatus;
};

type PrinterRowDb = {
  id: string;
  venue_id: string;
  device_id: string | null;
  destination: "cocina" | "barra" | "all" | "recibo";
  connection: { type?: string; host?: string; port?: number; printerName?: string };
};

type ResolvedPrinter = {
  id: string;
  venueId: string;
  destination: "cocina" | "barra" | "all" | "recibo";
  config: PrinterConfig;
};

/** Cabecera del ticket a partir de la marca del tenant (nombre comercial), leída con el
 * JWT del device (la RLS le permite leer `tenant_settings`). Nunca lanza: si no hay marca,
 * la cabecera queda vacía. */
async function ticketBranding(
  client: SupabaseClient,
): Promise<{ branding: TicketBranding; locale: string }> {
  const { data } = await client.from("tenant_settings").select("branding, locale").maybeSingle();
  const name = parseBranding(data?.branding).name;
  // `locale` solo lo usa el recibo, para formatear los importes ("18,00 €"). El texto de la
  // comanda no lleva dinero. Sin ajuste, `es` (Intl lo acepta igual que la carta).
  return { branding: { header: name ?? "" }, locale: (data?.locale as string | undefined) ?? "es" };
}

/** Impresora id del PROPIO dispositivo del agente, leída con su JWT (`devices_select_own`
 * devuelve solo la fila cuyo `auth_user_id = auth.uid()`). `null` si no hay fila (p. ej. un
 * device sembrado sin fila en `devices`): entonces no se reclama ninguna USB. */
async function ownDeviceId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.from("devices").select("id").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Las impresoras habilitadas del tenant, con las columnas que necesitan AMBOS consumidores del
 *  tick (resolver a dónde imprimir Y calcular qué falta por imprimir). Se consulta una sola vez
 *  por tick y se comparte, en vez de dos veces (#13). Es un superconjunto de `EnabledPrinterRow`,
 *  así que sirve tal cual a `selectUnprintedOrders`. */
async function enabledPrinterRows(client: SupabaseClient): Promise<PrinterRowDb[]> {
  const { data, error } = await client
    .from("printers")
    .select("id, venue_id, device_id, destination, connection")
    .eq("enabled", true);
  if (error) throw error;
  return data as unknown as PrinterRowDb[];
}

/**
 * Impresoras habilitadas que este agente puede imprimir, con su `PrinterConfig` ya
 * construida por tipo. Puro (recibe las filas ya leídas y el propio device id):
 *   - RED (`connection.type === "network"`): cualquier agente del tenant la alcanza; el
 *     acotado por local (`venue_id`) lo aplica el bucle de impresión (igual que antes).
 *   - USB (`connection.type === "usb"`): SOLO si `device_id` es el propio dispositivo -- una
 *     impresora USB está físicamente en ESTE PC, así que ningún otro agente debe reclamarla.
 * Un tipo desconocido, o una USB de otro device, se ignora.
 */
function resolvePrintersFromRows(rows: PrinterRowDb[], deviceId: string | null): ResolvedPrinter[] {
  const resolved: ResolvedPrinter[] = [];
  for (const p of rows) {
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

/** Estado de una impresora de RED tras sondear su conexión (#12): `ok` si aceptó la conexión. */
export type NetworkPrinterProbe = {
  id: string;
  label: string;
  host: string;
  port: number;
  destination: "cocina" | "barra" | "all" | "recibo";
  ok: boolean;
  reason?: string;
};

type NetworkPrinterRow = {
  id: string;
  name: string;
  destination: "cocina" | "barra" | "all" | "recibo";
  connection: { type?: string; host?: string; port?: number };
};

/**
 * Sondea la conexión de TODAS las impresoras de RED habilitadas del tenant y devuelve su estado.
 * Diagnóstico MANUAL que dispara el owner desde el desktop: usa el MISMO cliente del agente (no
 * uno nuevo -- eso competiría por la rotación del refresh token, #11), y `probeTcp` no compite
 * con la entrega porque el owner lo lanza cuando no se está imprimiendo. Las USB no salen aquí:
 * su prueba es "Imprimir prueba" (winspool), que ya existe.
 */
export async function probeNetworkPrinters(client: SupabaseClient): Promise<NetworkPrinterProbe[]> {
  const { data, error } = await client
    .from("printers")
    .select("id, name, destination, connection")
    .eq("enabled", true);
  if (error) throw error;

  const network = (data as unknown as NetworkPrinterRow[]).filter(
    (p) => p.connection?.type === "network" && typeof p.connection.host === "string",
  );
  return Promise.all(
    network.map(async (p) => {
      const host = p.connection.host as string;
      const port = p.connection.port as number;
      const { ok, reason } = await probeTcp(host, port);
      return { id: p.id, label: p.name, host, port, destination: p.destination, ok, reason };
    }),
  );
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

/** El pedido como RECIBO de cliente (con importes y código de recogida). El código sale del token
 *  público con la MISMA regla que la pantalla del totem (`pickupCodeFromToken`), para que cuadren. */
function toReceiptOrder(order: PrintableOrder, locale: string): ReceiptOrder {
  return {
    orderNumber: order.orderNumber,
    tableLabel: order.tableLabel,
    createdAt: order.createdAt,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      extras: item.extras,
      lineCents: item.lineCents,
    })),
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    /* Se reutiliza la MISMA función que calculó los totales del pedido en vez de reagrupar aquí:
       si el recibo hiciera su propia aritmética, tarde o temprano se separaría del total impreso
       arriba por un céntimo. Cada línea entra ya con su total, así que basta envolverla. */
    taxBreakdown: taxBreakdown(
      order.items.map((item) => ({
        unitPrice: item.lineCents,
        quantity: 1,
        extras: [],
        taxRate: item.taxRate,
      })),
    ).map((bucket) => ({
      taxRate: bucket.taxRate,
      baseCents: bucket.base,
      taxCents: bucket.taxAmount,
    })),
    currency: order.currency,
    locale,
    pickupCode: pickupCodeFromToken(order.publicToken),
  };
}

/**
 * UNA pasada del agente: lee los pedidos pendientes con el JWT del device, y por cada
 * pedido y cada impresora de RED de destino que aún no conste en `printedTargets`, entrega
 * el ticket y, SOLO si la entrega tuvo éxito, marca esa impresora vía `reserve_printed_self`
 * (RPC, JWT del device -- nunca el service role). Orden entregar→marcar (at-least-once): un
 * fallo entre ambos reimprime en el siguiente tick, nunca pierde el ticket. La marca es por
 * impresora, así que un pedido con una impresora ok y otra caída solo reintenta la caída.
 *
 * `health` (#15) acumula lo que se sabe del estado de cada impresora: cada entrega lo alimenta
 * -- una entrega completada es mejor prueba que cualquier sonda -- y al cerrar el tick se sondea
 * lo que no tenga evidencia fresca. De ahí sale `receiptStatus`, que el totem consulta antes de
 * cobrar. Sin `health` el tick funciona igual; solo devuelve `unknown`.
 */
export async function runAgentTick(
  client: SupabaseClient,
  appVersion: string | null = null,
  osPrinters: string[] | null = null,
  health: PrinterHealth | null = null,
): Promise<AgentTickResult> {
  // Una sola lectura de `printers` por tick, compartida entre "qué falta imprimir"
  // (`selectUnprintedOrders`) y "a qué impresora" (`resolvePrintersFromRows`) -- antes se
  // consultaba dos veces (#13). Las cuatro lecturas van en paralelo (1 RTT).
  const [printerRows, orderRows, { branding, locale }, deviceId] = await Promise.all([
    enabledPrinterRows(client),
    paidUnprintedOrderRows(client),
    ticketBranding(client),
    ownDeviceId(client),
  ]);
  const orders = selectUnprintedOrders(orderRows, printerRows);
  const printers = resolvePrintersFromRows(printerRows, deviceId);

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
      // El recibo del cliente sale SOLO en pedidos de totem (canal kiosko); las de estación
      // (cocina/barra/all) imprimen la comanda como siempre. Debe casar con `targetPrinterIds`
      // y con el SQL `reserve_printed`, que deciden cuándo el pedido queda del todo impreso.
      const applies =
        dest === "recibo"
          ? order.channel === "kiosko"
          : dest === "all" || neededDestinations.has(dest);
      if (!applies) continue;
      if (Object.hasOwn(order.printedTargets, printer.id)) continue;

      const lines =
        dest === "recibo"
          ? buildReceiptLines(toReceiptOrder(order, locale), branding)
          : buildTicketLines(ticketOrder, branding, dest);
      const result = await enqueueByDevice(deviceKey(printer.config), () =>
        printToPrinter(lines, printer.config),
      );
      health?.record(printer.config, result);
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

  // Sondeo de lo que no se ha ejercitado con una entrega real. Va DESPUÉS del bucle de
  // impresión a propósito: primero salen los tickets que la gente está esperando, y el
  // diagnóstico se cobra el tiempo que sobra. Un fallo aquí no puede derribar el tick.
  const recibo = printers.filter((p) => p.destination === "recibo");
  if (health) {
    try {
      await health.refresh(printers.map((p) => p.config));
    } catch (error) {
      console.error("[agent] fallo al sondear impresoras:", error);
    }

    /* Lo que dice la sonda de las impresoras que este tick no ha ejercitado. Sin esto, el local
       solo se entera de que la cocina está apagada cuando alguien ya ha pagado un pedido que no
       va a salir; con esto se entera a los cuatro segundos de que se apague, con la barra vacía. */
    const yaVista = new Set([...succeeded, ...failures.map((f) => f.printerId)]);
    for (const printer of printers) {
      if (yaVista.has(printer.id)) continue;
      const estado = health.read(printer.config);
      if (estado.status === "ok") succeeded.add(printer.id);
      else if (estado.status === "down") {
        failures.push({
          printerId: printer.id,
          orderNumber: null,
          destination: printer.destination,
          reason: estado.reason,
        });
      }
    }
  }
  const receiptStatus = health
    ? aggregateStatus(recibo.map((p) => health.read(p.config)))
    : ({ status: "unknown" } as const);

  // Heartbeat informativo: nunca derriba el tick. `client.rpc(...)` devuelve un
  // PostgrestBuilder que solo implementa `PromiseLike` (tiene `.then`, no `.catch`), así que
  // se envuelve en try/await/catch en vez de encadenar `.catch` directamente.
  try {
    // `p_printers` null (fuera de Electron, o si enumerar falló) NO borra las ya reportadas:
    // la RPC hace `coalesce(p_printers, printers)`.
    await client.rpc("device_heartbeat", { p_app_version: appVersion, p_printers: osPrinters });
  } catch {
    // informativo: un fallo aquí no debe derribar el tick de impresión.
  }

  return { printed, failed, succeeded: [...succeeded], failures, receiptStatus };
}

/**
 * Arranca el agente: crea el cliente del dispositivo, sondea cada `pollMs` Y se suscribe a
 * Realtime para reaccionar a un pedido nuevo al instante en vez de esperar hasta 4 s. El poll
 * NO desaparece: es el respaldo (at-least-once). Si Realtime se cae, se reconecta tarde o
 * pierde un evento, el siguiente poll lo recoge -- la garantía de que un ticket acaba
 * imprimiéndose sigue siendo el poll, no Realtime. Devuelve una función que para AMBOS.
 *
 * Un error en un tick se registra pero no derriba el bucle -- el siguiente tick reintenta.
 */
export async function runAgent(
  creds: AgentCredentials,
  opts?: {
    pollMs?: number;
    /** Versión de la app de escritorio, para el heartbeat: así el panel sabe qué locales
     *  están en una build vieja (relevante con el auto-update). La conoce la cáscara Electron
     *  (`app.getVersion()`), no este paquete, así que llega por aquí. */
    appVersion?: string;
    /** Nombres de impresoras que ve el SO, para reportarlos en el heartbeat y que el panel
     *  admin los ofrezca en un desplegable. Los enumera la cáscara Electron
     *  (`getPrintersAsync`), no este paquete, así que llega por aquí y se resuelve en CADA tick
     *  (las impresoras se enchufan/desenchufan). Si falla o no se pasa, el heartbeat va sin
     *  lista y no borra las ya reportadas. */
    getPrinters?: () => string[] | Promise<string[]>;
    /** Se llama tras CADA tick con su resultado -- la cáscara Electron lo usa para dar
     *  visibilidad (cuántos impresos, qué impresora cayó) en vez de ser una caja negra. Un
     *  tick que revienta llega aquí con `error` puesto, nunca se traga en silencio. */
    onTick?: (result: AgentTickResult) => void;
  },
): Promise<AgentHandle> {
  const client = await createDeviceClient(creds);
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const appVersion = opts?.appVersion ?? null;

  // Vive lo que vive el agente, no lo que vive un tick: el valor de esto es precisamente
  // acumular evidencia entre ticks para poder contestar al instante cuando el totem pregunta.
  const health = createPrinterHealth();
  let receiptStatus: PrinterStatus = { status: "unknown" };

  // `running` evita solapar ticks; `pending` recuerda que llegó un disparo (poll o Realtime)
  // MIENTRAS uno corría, para relanzar UNO al terminar en vez de perderlo. Juntos coalescen
  // una ráfaga de eventos de Realtime en el mínimo de ticks sin perder ninguno.
  let running = false;
  let pending = false;

  const tick = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      let osPrinters: string[] | null = null;
      if (opts?.getPrinters) {
        // Enumerar las impresoras nunca debe derribar un tick de impresión: si falla, se manda
        // el heartbeat sin lista (que conserva la anterior).
        try {
          osPrinters = await opts.getPrinters();
        } catch {
          osPrinters = null;
        }
      }
      const result = await runAgentTick(client, appVersion, osPrinters, health);
      receiptStatus = result.receiptStatus;
      opts?.onTick?.(result);
    } catch (error) {
      console.error("[agent] tick falló:", error);
      // El tick reventó ANTES de poder mirar las impresoras (típicamente sin red). No se toca
      // `receiptStatus`: la última evidencia real sigue siendo la mejor que hay, y su propia
      // caducidad la degradará a `unknown` sola si esto se prolonga.
      opts?.onTick?.({
        printed: 0,
        failed: 0,
        succeeded: [],
        failures: [],
        receiptStatus,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void tick();
      }
    }
  };

  const timer = setInterval(() => void tick(), pollMs);

  // Vía rápida: un pedido que pasa a `paid` dispara un tick al instante (los cambios de
  // kitchen_status/bar_status que hace el personal NO -- no cambian qué hay que imprimir).
  // Sin tenantId (tests que llaman a runAgentTick directo) no hay canal; el poll basta.
  let unsubscribe: (() => void) | null = null;
  if (creds.tenantId) {
    unsubscribe = subscribeToOrders(client, creds.tenantId, (order) => {
      if (order.status === "paid") void tick();
    });
  }

  return {
    receiptPrinterStatus: () => stillFresh(receiptStatus, Date.now()),
    stop: () => {
      clearInterval(timer);
      unsubscribe?.();
    },
    // Reusa el cliente ya autenticado del agente para el diagnóstico manual de red (#12).
    probeNetworkPrinters: () => probeNetworkPrinters(client),
    client,
  };
}

/** Lo que devuelve `runAgent`: parar el agente, sondear las impresoras de red bajo demanda, y el
 *  CLIENTE ya autenticado del device. El totem lo reutiliza para cobrar (una sola sesión, un solo
 *  bucle de refresh: dos clientes sobre el mismo almacén se pisarían la rotación del refresh
 *  token). Es el mismo cliente que usa el tick de impresión. */
export type AgentHandle = {
  stop: () => void;
  probeNetworkPrinters: () => Promise<NetworkPrinterProbe[]>;
  /**
   * Estado de la impresora de recibos AHORA (#15), sin tocar la red: contesta con lo que el
   * último tick dejó apuntado. Tiene que ser instantáneo porque quien pregunta es el totem con
   * un cliente delante a punto de pasar la tarjeta -- tres segundos de sonda ahí serían tres
   * segundos de pantalla congelada.
   *
   * La caducidad se aplica al MIRAR, no al guardar: si el agente lleva un rato sin poder dar un
   * tick (sin red), lo último que supo deja de valer y esto pasa a `unknown` solo.
   */
  receiptPrinterStatus: () => PrinterStatus;
  client: SupabaseClient;
};
