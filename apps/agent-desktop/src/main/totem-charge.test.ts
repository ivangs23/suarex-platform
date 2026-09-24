import type { SupabaseClient } from "@suarex/agent";
import { describe, expect, it, vi } from "vitest";
import { chargeKioskoOrder } from "./totem-charge.js";

/**
 * Cliente de Supabase FALSO, con lo justo que tocan las tres funciones de `@suarex/db` que compone
 * `chargeKioskoOrder`: `readKioskoOrderForCharge` (from/select/eq/maybeSingle sobre `orders`),
 * `getPaymentConfigForDevice` (rpc `get_payment_config_self`) y `markKioskoOrderPaid` (rpc
 * `mark_kiosko_order_paid`). Devuelve un espía de `mark` para comprobar que se llama tras aprobar.
 */
function fakeClient(over: {
  order?: { total: number; status: string; order_number: number; channel: string } | null;
  config?: Record<string, unknown>[] | null;
  markResult?: boolean;
}) {
  const order =
    over.order === undefined
      ? { total: 12, status: "pending", order_number: 7, channel: "kiosko" }
      : over.order;
  const mark = vi.fn(async (_args?: unknown) => ({ data: over.markResult ?? true, error: null }));
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: order, error: null }) }),
      }),
    }),
    rpc: (name: string, args?: unknown) => {
      if (name === "get_payment_config_self") {
        const config =
          over.config === undefined
            ? [
                {
                  provider: "paytef",
                  access_key: "AK",
                  secret_key: "SK",
                  company_id: "1",
                  mock: true,
                  pinpad_id: "PIN-1",
                },
              ]
            : over.config;
        return Promise.resolve({ data: config, error: null });
      }
      if (name === "mark_kiosko_order_paid") return mark(args);
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return { client, mark };
}

describe("chargeKioskoOrder (composición del totem en el desktop)", () => {
  it("con config mock: cobra el importe del servidor y marca el pedido pagado", async () => {
    const { client, mark } = fakeClient({});
    const result = await chargeKioskoOrder(client, "ord-1");
    expect(result.status).toBe("paid");
    if (result.status === "paid") expect(result.authCode).toBe("MOCK-000000");
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("sin config de pago: no cobra ni marca, y lo dice", async () => {
    const { client, mark } = fakeClient({ config: null });
    const result = await chargeKioskoOrder(client, "ord-1");
    // `declined` y no `in-doubt`: el fallo es ANTES de cobrar, así que no se ha movido dinero.
    expect(result.status).toBe("declined");
    if (result.status === "declined") expect(result.reason).toMatch(/terminal|configurado/i);
    expect(mark).not.toHaveBeenCalled();
  });

  it("el importe cobrado sale del pedido (servidor), no del renderer", async () => {
    // `charge` inyectado para inspeccionar el importe: el pedido es 12,00 € -> 1200 céntimos.
    const { client } = fakeClient({});
    const charge = vi.fn(async () => ({ approved: true as const, authCode: "X" }));
    await chargeKioskoOrder(client, "ord-1", { charge });
    expect(charge).toHaveBeenCalledWith(
      expect.objectContaining({ pinpad: "PIN-1", mock: true }),
      1200,
      expect.stringContaining("ord-1"),
      expect.anything(),
    );
  });
});
