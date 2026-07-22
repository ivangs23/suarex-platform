import { markOrderPaid } from "@suarex/db";
import { describe, expect, it } from "vitest";
import { nonce } from "./helpers/tenants.js";

describe("markOrderPaid", () => {
  it("distingue un PaymentIntent que no corresponde a ningún pedido", async () => {
    // No es un caso benigno: significa que se cobró algo de lo que este sistema
    // no tiene registro, o que el webhook apunta al entorno equivocado.
    expect(await markOrderPaid(`pi_desconocido_${nonce()}`)).toBe("order-not-found");
  });
});
