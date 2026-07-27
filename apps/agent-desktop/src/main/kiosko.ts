import type { ChargeEvent } from "./charge-journal.js";
import type { PaymentResult, PaymentStatus, ResolvedPaymentConfig } from "./payment-provider.js";

// Orquestación del cobro de un pedido del totem: leer el importe (del SERVIDOR), resolver la
// config del datáfono, cobrar por Paytef y, si aprueba, marcar el pedido pagado. Las
// dependencias se inyectan para probar la lógica sin Electron, red, ni base de datos.

export type ChargeOrderDeps = {
  /** Lee el pedido kiosko con el JWT del device: importe (céntimos, de la base) y estado. */
  readOrder: (orderId: string) => Promise<{ amountCents: number; status: string } | null>;
  /** Resuelve la config del método de pago de este totem (cuenta + terminal). `null` si no hay. */
  getConfig: () => Promise<ResolvedPaymentConfig | null>;
  /** Cobra con el proveedor configurado (o simula). */
  charge: (
    config: ResolvedPaymentConfig,
    amountCents: number,
    transactionReference: string,
    opts: {
      onStatus?: (s: PaymentStatus, m: string) => void;
      isCancelled?: () => boolean;
      onSession?: (sessionId: string) => void | Promise<void>;
    },
  ) => Promise<PaymentResult>;
  /** Marca el pedido pagado tras aprobar (RPC acotada). `true` si marcó. */
  markPaid: (orderId: string) => Promise<boolean>;
  /**
   * Apunta un evento en el DIARIO DURABLE de cobros, y no vuelve hasta que está en disco.
   *
   * Es lo único que sobrevive a que el totem se apague a mitad de un pago: sin él, morir entre
   * que el datáfono aprueba y el pedido queda marcado no deja rastro en ninguna parte y el
   * cliente se queda pagado, sin comida y sin nadie a quien reclamar. Opcional para que los
   * tests que solo miran la lógica del cobro no tengan que montar un fichero.
   */
  journal?: (event: ChargeEvent) => Promise<void>;
};

/**
 * Un evento del diario tal y como lo escribe `chargeOrder`, sin `ref` ni `at`: esos dos los pone
 * ella, que es quien conoce la referencia de la operación y el reloj inyectado.
 *
 * El rodeo por un tipo genérico NO sobra: un `Omit` aplicado directamente a una unión la aplasta
 * a sus claves COMUNES, y entonces `{ t: "approved", authCode }` deja de compilar. Con el
 * parámetro desnudo, el condicional se DISTRIBUYE sobre cada miembro y cada variante conserva lo
 * suyo.
 */
type SinReferencia<T> = T extends unknown ? Omit<T, "ref" | "at"> : never;
type EventoSinReferencia = SinReferencia<ChargeEvent>;

/**
 * Cómo acabó el cobro. Son TRES desenlaces, no dos, y la diferencia es dinero real:
 *
 *  - `paid`     — cobrado y registrado. Todo en orden.
 *  - `declined` — no se ha movido un céntimo (denegada, cancelada, sin configurar…). Se puede
 *                 reintentar sin miedo.
 *  - `in-doubt` — el datáfono APROBÓ pero no hemos podido registrarlo. El cliente ya ha pagado.
 *                 Reintentar aquí sería cobrar dos veces, así que jamás se ofrece "reintentar":
 *                 se avisa al personal con el código de autorización para que lo resuelva.
 *
 * Colapsar `in-doubt` en `declined` es exactamente lo que produce clientes cobrados sin comida.
 */
export type ChargeOrderResult =
  | { status: "paid"; authCode: string }
  | { status: "declined"; reason: string }
  | { status: "in-doubt"; authCode: string; reason: string };

/** Intentos de REGISTRAR un cobro ya aprobado. Solo se reintenta el marcado -- nunca el cobro. */
const MARK_ATTEMPTS = 4;

/**
 * Cobra un pedido del totem de principio a fin. El importe SIEMPRE sale de `readOrder` (la base),
 * nunca del renderer, para que un XSS en la carta no pueda cobrar un importe arbitrario.
 * Idempotente ante un pedido ya pagado (no re-cobra).
 */
export async function chargeOrder(
  deps: ChargeOrderDeps,
  orderId: string,
  opts: {
    onStatus?: (s: PaymentStatus, m: string) => void;
    isCancelled?: () => boolean;
    now?: () => number;
    /** Espera entre reintentos del marcado. Inyectable para no dormir de verdad en las pruebas. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ChargeOrderResult> {
  const order = await deps.readOrder(orderId);
  if (!order) return { status: "declined", reason: "Pedido no encontrado" };
  // Ya pagado: idempotente, no se vuelve a cobrar (p. ej. un reintento tras un corte de red).
  if (order.status === "paid") return { status: "paid", authCode: "" };
  if (order.status !== "pending") {
    return { status: "declined", reason: "El pedido no está pendiente de pago" };
  }

  const config = await deps.getConfig();
  if (!config) return { status: "declined", reason: "El terminal de pago no está configurado" };

  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const reference = `ORD-${orderId}-${now()}`;
  const journal = deps.journal;
  const anota = (event: EventoSinReferencia): Promise<void> =>
    journal ? journal({ ...event, ref: reference, at: now() } as ChargeEvent) : Promise.resolve();

  /* ANTES de hablar con el datáfono, y en disco. Este es el orden que hace recuperable un corte
     de corriente: si solo se apuntara lo aprobado, morir DURANTE el cobro dejaría el mismo
     agujero una capa más abajo -- dinero cobrado del que no queda ni la referencia. */
  await anota({ t: "started", orderId, amountCents: order.amountCents });

  const result = await deps.charge(config, order.amountCents, reference, {
    onStatus: opts.onStatus,
    isCancelled: opts.isCancelled,
    // La sesión del datáfono, en cuanto existe: es lo que permite volver a preguntarle cómo
    // acabó la operación si el proceso muere a mitad.
    onSession: (sessionId) => anota({ t: "session", sessionId }),
  });
  if (!result.approved) {
    // Cerrado: no se ha movido un céntimo, así que no hay nada que recuperar al arrancar.
    await anota({ t: "declined", reason: result.reason });
    return { status: "declined", reason: result.reason };
  }

  // Aprobado y en disco ANTES de intentar registrarlo: a partir de aquí, pase lo que pase, el
  // siguiente arranque sabe que este cliente pagó y con qué código.
  await anota({ t: "approved", authCode: result.authCode });

  /* A PARTIR DE AQUÍ EL CLIENTE YA HA PAGADO. Lo único que puede fallar es registrarlo, y eso sí
     se reintenta: un corte de red de unos segundos no debe convertirse en un cobro sin pedido.
     El cobro NO se repite bajo ningún concepto. */
  for (let intento = 0; intento < MARK_ATTEMPTS; intento++) {
    if (intento > 0) await sleep(intento * 500);
    const marked = await deps.markPaid(orderId).catch(() => false);
    if (marked) {
      await anota({ t: "settled" });
      return { status: "paid", authCode: result.authCode };
    }
  }

  /* Cobrado y sin registrar. Se devuelve el código de autorización para que no se pierda: es lo
     que permite al personal casarlo con el cierre del datáfono y resolverlo a mano. */
  return {
    status: "in-doubt",
    authCode: result.authCode,
    reason: "El cobro se aprobó pero no se pudo registrar el pedido",
  };
}
