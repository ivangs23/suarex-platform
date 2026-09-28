import { describe, expect, it } from "vitest";
import { planStatusDeStripe } from "./billing-events";

/**
 * El mapeo de estados de Stripe a la política de este sistema. Se prueba aparte del route
 * handler a propósito: es la única parte del webhook que decide algo, y probarla exige
 * levantar un servidor Next si vive dentro de la ruta.
 */
describe("planStatusDeStripe", () => {
  it("traduce los estados que sí cambian el servicio", () => {
    expect(planStatusDeStripe("trialing")).toBe("trialing");
    expect(planStatusDeStripe("active")).toBe("active");
    expect(planStatusDeStripe("past_due")).toBe("past_due");
    expect(planStatusDeStripe("canceled")).toBe("canceled");
  });

  it("trata `unpaid` como impago, no como baja", () => {
    // Stripe pasa a `unpaid` cuando agota los reintentos. Tratarlo como `canceled` cortaría
    // sin gracia a un cliente que solo tiene la tarjeta caducada.
    expect(planStatusDeStripe("unpaid")).toBe("past_due");
  });

  it("trata `incomplete_expired` como baja", () => {
    // Un alta que nunca llegó a confirmar la tarjeta y ya expiró: no hay suscripción.
    expect(planStatusDeStripe("incomplete_expired")).toBe("canceled");
  });

  it("ignora los estados que NO deben tocar el servicio", () => {
    // `incomplete`: el alta está a medio confirmar la tarjeta. Tratarlo como impago cortaría
    // a un cliente que está justo terminando de darse de alta.
    expect(planStatusDeStripe("incomplete")).toBeNull();
    // `paused`: la facturación está pausada de acuerdo con el cliente. No es un fallo de
    // cobro y no debe abrir ventana de gracia ni suspender.
    expect(planStatusDeStripe("paused")).toBeNull();
  });

  it("ignora un estado desconocido en vez de adivinar", () => {
    // Si Stripe añade un estado nuevo, el webhook lo registra y no toca nada. Adivinar aquí
    // significaría cortar el servicio de un restaurante por un valor que nadie ha leído.
    expect(planStatusDeStripe("un_estado_que_no_existe")).toBeNull();
  });
});
