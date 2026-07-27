import type { SupabaseClient } from "@suarex/agent";
import { describe, expect, it, vi } from "vitest";
import type { ChargeJournal } from "./charge-journal.js";
import { chargeKioskoOrder } from "./totem-charge.js";

/**
 * Cliente de Supabase FALSO, con lo justo que tocan las tres funciones de `@suarex/db` que compone
 * `chargeKioskoOrder`: `readKioskoOrderForCharge` (from/select/eq/maybeSingle sobre `orders`),
 * `getPaymentConfigForDevice` (rpc `get_payment_config_self_v2`) y `markKioskoOrderPaid` (rpc
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
      if (name === "get_payment_config_self_v2") {
        const config =
          over.config === undefined
            ? [
                {
                  provider: "paytef",
                  config: { accessKey: "AK", companyId: "1" },
                  secrets: { secretKey: "SK" },
                  mock: true,
                  terminal_id: "PIN-1",
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
    /* Ya no se inyecta un `charge` de mentira: el proveedor lo resuelve el registro a partir de
       lo configurado, que es justo lo que se quiere probar. El importe se observa por el diario,
       que apunta el `started` con el importe ANTES de cobrar -- el pedido son 12,00 € -> 1200. */
    const { client } = fakeClient({});
    const eventos: { t: string; amountCents?: number }[] = [];
    const journal: ChargeJournal = {
      append: async (event) => {
        eventos.push(event);
      },
      pending: async () => [],
      compact: async () => {},
    };

    const result = await chargeKioskoOrder(client, "ord-1", { journal });

    expect(result.status).toBe("paid");
    expect(eventos[0]).toMatchObject({ t: "started", amountCents: 1200 });
  });

  it("un método de pago que este agente no conoce no revienta: no se cobra y se dice", async () => {
    // Una fila guardada por una versión más nueva del panel. Para el comensal es lo mismo que no
    // tener terminal; lo que no puede es tumbar el totem.
    const { client, mark } = fakeClient({
      config: [{ provider: "de-marte", config: {}, secrets: {}, mock: true, terminal_id: null }],
    });
    const result = await chargeKioskoOrder(client, "ord-1");
    expect(result.status).toBe("declined");
    expect(mark).not.toHaveBeenCalled();
  });

  it("el terminal del DISPOSITIVO llega al proveedor con el nombre que él declaró", async () => {
    /* La base guarda "el terminal de este dispositivo" sin saber que Paytef lo llama "pinpad".
       Quien hace esa correspondencia es el driver, y esto lo fija. */
    const { resolvePaymentConfig } = await import("./resolve-payment.js");
    const resuelta = resolvePaymentConfig("paytef", {
      provider: "paytef",
      config: { accessKey: "AK" },
      secrets: { secretKey: "SK" },
      mock: false,
      terminalId: "PIN-9",
    });
    expect(resuelta?.values).toMatchObject({ accessKey: "AK", secretKey: "SK", pinpad: "PIN-9" });
  });
});
