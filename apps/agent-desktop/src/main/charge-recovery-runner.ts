import type { SupabaseClient } from "@suarex/agent";
import {
  getPaymentConfigForDevice,
  markKioskoOrderPaid,
  readKioskoOrderForCharge,
} from "@suarex/db";
import type { ChargeJournal } from "./charge-journal.js";
import type { RecoveryDeps, RecoveryOutcome, SessionOutcome } from "./charge-recovery.js";
import { recoverCharges } from "./charge-recovery.js";
import { type PaytefBridgeConfig, pollPaytefSession } from "./paytef.js";

/**
 * Compone las piezas reales de la recuperación de cobros y la lanza AL ARRANCAR.
 *
 * Es el momento exacto en que hace falta: si el totem se apagó a mitad de un pago, esta es la
 * primera oportunidad de enterarse. La decisión de qué hacer con cada cobro vive en
 * `recoverCharges` (pura y probada rama a rama); aquí solo se le dan el servidor, el datáfono y
 * el diario de verdad.
 *
 * Nunca lanza: un fallo recuperando no puede impedir que el totem arranque y siga vendiendo. Lo
 * que sí hace siempre es DEJAR CONSTANCIA -- en el registro y, si hay dinero de por medio, con
 * un aviso -- porque un cobro sin resolver que además se pierde en silencio es el peor de los dos
 * mundos.
 */
export async function runChargeRecovery(params: {
  client: SupabaseClient;
  journal: ChargeJournal;
  log: (mensaje: string) => void;
  /** Se llama una vez por cobro que necesita a una persona. */
  alert: (outcome: RecoveryOutcome) => void;
}): Promise<RecoveryOutcome[]> {
  const { client, journal, log, alert } = params;

  const pendientes = await journal.pending().catch(() => []);
  if (pendientes.length === 0) return [];

  log(`Recuperando ${pendientes.length} cobro(s) que quedaron a medias.`);

  const deps: RecoveryDeps = {
    /* `readKioskoOrderForCharge` devuelve `null` tanto si el pedido no existe como si no es de
       canal kiosko. Aquí eso es lo mismo: una entrada del diario SIEMPRE nació de un cobro de
       totem, así que un `null` solo puede significar que ese pedido ya no está. */
    orderStatus: async (orderId) => {
      const order = await readKioskoOrderForCharge(client, orderId);
      if (!order) return "missing";
      if (order.status === "paid") return "paid";
      return order.status === "pending" ? "pending" : "other";
    },
    markPaid: (orderId) => markKioskoOrderPaid(client, orderId),
    pollSession: async (sessionId): Promise<SessionOutcome> => {
      const cfg = await getPaymentConfigForDevice(client);
      if (!cfg) return { kind: "unknown" };
      const bridge: PaytefBridgeConfig = {
        accessKey: cfg.accessKey,
        secretKey: cfg.secretKey,
        companyId: cfg.companyId,
        pinpad: cfg.pinpadId ?? "",
        mock: cfg.mock,
      };
      const interp = await pollPaytefSession(bridge, sessionId);
      if (interp.kind !== "final") return { kind: "unknown" };
      return interp.approved
        ? { kind: "approved", authCode: interp.authCode }
        : { kind: "declined", reason: interp.reason };
    },
    onSettled: (charge) => journal.append({ t: "settled", ref: charge.ref, at: Date.now() }),
    onApproved: (charge, authCode) =>
      journal.append({ t: "approved", ref: charge.ref, authCode, at: Date.now() }),
  };

  const resultados = await recoverCharges(deps, pendientes);

  for (const resultado of resultados) {
    const importe = (resultado.amountCents / 100).toFixed(2);
    const codigo = resultado.authCode ? ` (autorización ${resultado.authCode})` : "";
    if (resultado.kind === "settled") {
      log(`Cobro recuperado: pedido ${resultado.orderId}, ${importe} €. ${resultado.detail}.`);
    } else {
      log(`ATENCIÓN: pedido ${resultado.orderId}, ${importe} €. ${resultado.detail}${codigo}.`);
      alert(resultado);
    }
  }

  /* Compactar DESPUÉS de recuperar: lo cerrado se va del fichero y lo que sigue pendiente se
     queda entero, para que el siguiente arranque vuelva a intentarlo (y a avisar) mientras nadie
     lo resuelva. Un aviso que solo sale una vez es un aviso que se pierde. */
  await journal.compact().catch(() => {});

  return resultados;
}
