import type { SupabaseClient } from "@suarex/agent";
import {
  getPaymentConfigForDevice,
  markKioskoOrderPaid,
  readKioskoOrderForCharge,
} from "@suarex/db";
import { type ChargeOrderResult, chargeOrder } from "./kiosko.js";
import { chargePaytef, type PaytefBridgeConfig } from "./paytef.js";

/**
 * Cobra un pedido del totem de principio a fin, componiendo las piezas ya construidas y probadas:
 * lee el importe del SERVIDOR (`readKioskoOrderForCharge`), resuelve la config del datáfono
 * (`getPaymentConfigForDevice`, incluido el pinpad de ESTE device), cobra por Paytef
 * (`chargePaytef` -- real o mock según la config del tenant) y marca el pedido pagado
 * (`markKioskoOrderPaid`). Todo con el cliente del device (RLS + RPCs acotadas), nunca la service
 * key. `charge` se inyecta para probar sin red; en producción es `chargePaytef`.
 */
export async function chargeKioskoOrder(
  client: SupabaseClient,
  orderId: string,
  opts: { charge?: typeof chargePaytef } = {},
): Promise<ChargeOrderResult> {
  const charge = opts.charge ?? chargePaytef;
  return chargeOrder(
    {
      readOrder: (id) => readKioskoOrderForCharge(client, id),
      getConfig: async () => {
        const cfg = await getPaymentConfigForDevice(client);
        if (!cfg) return null;
        // La config de la carta (@suarex/db) al contrato del puente Paytef: el pinpad de ESTE
        // device es el datáfono; en mock no se usa, pero se mantiene la forma.
        const bridge: PaytefBridgeConfig = {
          accessKey: cfg.accessKey,
          secretKey: cfg.secretKey,
          companyId: cfg.companyId,
          pinpad: cfg.pinpadId ?? "",
          mock: cfg.mock,
        };
        return bridge;
      },
      charge: (config, amountCents, ref, o) => charge(config, amountCents, ref, o),
      markPaid: (id) => markKioskoOrderPaid(client, id),
    },
    orderId,
  );
}
