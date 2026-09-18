import { describe, expect, it } from "vitest";
import { DIAS_DE_GRACIA, decidirEstado } from "./billing.js";

/**
 * LA POLÍTICA DE IMPAGOS, ENTERA Y SIN RED.
 *
 * `decidirEstado` es pura a propósito: es la parte de este bloque que más se va a discutir y
 * cambiar, así que vive donde se puede probar exhaustivamente sin Stripe, sin red y sin base
 * de datos. Si algún día alguien afloja la ventana de gracia, tiene que romper un test aquí.
 */

const AHORA = new Date("2026-09-15T12:00:00Z");

describe("decidirEstado", () => {
  it("sirve durante el periodo de prueba y estando al corriente", () => {
    expect(decidirEstado("trialing", AHORA, null).status).toBe("active");
    expect(decidirEstado("active", AHORA, null).status).toBe("active");
  });

  it("un impago NO corta: abre la ventana de gracia", () => {
    // Decisión D2 del spec, hecha código. Cortar la carta en hora de comida por un rechazo
    // de tarjeta cuesta más que una semana de servicio regalado.
    const decision = decidirEstado("past_due", AHORA, null);
    expect(decision.status).toBe("active");
    expect(decision.graceUntil?.getTime()).toBe(AHORA.getTime() + DIAS_DE_GRACIA * 86400_000);
  });

  it("un segundo impago no reinicia la ventana ya abierta", () => {
    // Stripe reintenta varias veces un recibo impagado. Si cada reintento fallido extendiera
    // la gracia, la ventana no vencería NUNCA y el corte no existiría en la práctica.
    const yaAbierta = new Date("2026-09-18T12:00:00Z");
    expect(decidirEstado("past_due", AHORA, yaAbierta).graceUntil).toEqual(yaAbierta);
    expect(decidirEstado("past_due", AHORA, yaAbierta).status).toBe("active");
  });

  it("la gracia vencida sí corta", () => {
    const vencida = new Date("2026-09-01T12:00:00Z");
    expect(decidirEstado("past_due", AHORA, vencida).status).toBe("suspended");
  });

  it("una baja corta de inmediato y cierra la ventana", () => {
    // Cancelar es una decisión del cliente, no un fallo de cobro: no hay nada que esperar.
    const decision = decidirEstado("canceled", AHORA, null);
    expect(decision.status).toBe("suspended");
    expect(decision.graceUntil).toBeNull();
  });

  it("volver a estar al corriente reabre el servicio y borra la ventana", () => {
    // Sin esto, un tenant que paga tras un impago arrastraría su `grace_until` y el barrido
    // diario lo suspendería igualmente al vencer.
    const decision = decidirEstado("active", AHORA, new Date("2026-09-18T12:00:00Z"));
    expect(decision.status).toBe("active");
    expect(decision.graceUntil).toBeNull();
  });

  it("la ventana que vence exactamente ahora ya no protege", () => {
    // Frontera explícita: `>` y no `>=`. Un test que solo probara "ayer" y "mañana" dejaría
    // este borde a merced de quien edite la comparación.
    expect(decidirEstado("past_due", AHORA, AHORA).status).toBe("suspended");
  });
});
