import type { SupabaseClient } from "@suarex/agent";
import {
  getPaymentConfigForDevice,
  markKioskoOrderPaid,
  readKioskoOrderForCharge,
} from "@suarex/db";
import type { ChargeJournal } from "./charge-journal.js";
import { type ChargeOrderResult, chargeOrder } from "./kiosko.js";
import type { PaymentProvider, ResolvedPaymentConfig } from "./payment-provider.js";
import { paymentRegistry, resolvePaymentConfig } from "./resolve-payment.js";

/**
 * Cobra un pedido del totem de principio a fin, componiendo las piezas ya construidas y probadas:
 * lee el importe del SERVIDOR (`readKioskoOrderForCharge`), resuelve el método de pago configurado
 * (`getPaymentConfigForDevice` + el registro de proveedores), cobra con ese proveedor y marca el
 * pedido pagado (`markKioskoOrderPaid`). Todo con el cliente del device (RLS + RPCs acotadas),
 * nunca la service key.
 *
 * Qué proveedor se usa NO está escrito aquí: sale de lo que el dueño configuró. Cambiar de método
 * de pago es cambiar una fila, no tocar este fichero.
 */
export async function chargeKioskoOrder(
  client: SupabaseClient,
  orderId: string,
  opts: { journal?: ChargeJournal } = {},
): Promise<ChargeOrderResult> {
  /* Se resuelve una vez en `getConfig` y se guarda aquí para que `charge` use EL MISMO proveedor
     que produjo esa config. Volver a buscarlo abriría la puerta a cobrar con un proveedor y una
     configuración que no se corresponden si alguien cambia los ajustes a mitad de operación. */
  let elegido: PaymentProvider | null = null;

  return chargeOrder(
    {
      readOrder: (id) => readKioskoOrderForCharge(client, id),
      getConfig: async (): Promise<ResolvedPaymentConfig | null> => {
        const device = await getPaymentConfigForDevice(client);
        if (!device) return null;

        const provider = paymentRegistry.get(device.provider);
        if (!provider) {
          /* Configurado un proveedor que esta versión del agente no conoce: el totem no puede
             cobrar, pero tampoco debe reventar. Para el comensal es lo mismo que no tener
             terminal; para quien mantenga esto, el registro dice exactamente qué pasó. */
          console.error(`[totem] método de pago desconocido en este agente: ${device.provider}`);
          return null;
        }
        elegido = provider;
        return resolvePaymentConfig(device.provider, device);
      },
      charge: (config, amountCents, ref, o) => {
        if (!elegido) throw new Error("charge sin proveedor resuelto");
        return elegido.charge(config, amountCents, ref, o);
      },
      markPaid: (id) => markKioskoOrderPaid(client, id),
      // Sin diario el cobro funciona igual; con él, un tirón del enchufe deja de ser un cobro
      // perdido. Ver `charge-journal.ts` y `runChargeRecovery`.
      journal: opts.journal
        ? (event) => opts.journal?.append(event) ?? Promise.resolve()
        : undefined,
    },
    orderId,
  );
}
