import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BillingBanner } from "./BillingBanner";

/**
 * El aviso de impago es lo que hace que la ventana de gracia sirva de algo: siete días de
 * silencio seguidos de un corte sorpresa son PEORES que cortar el primer día, porque el
 * cliente se entera cuando ya no puede servir mesas.
 *
 * `renderToStaticMarkup`, igual que `themes/contract.test.tsx`: este paquete no tiene DOM ni
 * testing-library, y no hace falta para comprobar qué se pinta.
 */
const render = (props: Parameters<typeof BillingBanner>[0]) =>
  renderToStaticMarkup(<BillingBanner {...props} />);

describe("BillingBanner", () => {
  it("avisa en past_due y dice hasta cuándo", () => {
    const html = render({ planStatus: "past_due", graceUntil: "2026-09-22T10:00:00.000Z" });
    expect(html).toContain("billing-banner");
    expect(html).toContain("22/9/2026");
  });

  it("no pinta nada estando al corriente", () => {
    expect(render({ planStatus: "active", graceUntil: null })).toBe("");
  });

  it("no pinta nada durante el periodo de prueba", () => {
    // Un cliente en trial no debe ver una alarma roja cada vez que entra en su panel.
    expect(render({ planStatus: "trialing", graceUntil: null })).toBe("");
  });

  it("avisa aunque no haya fecha de gracia, sin imprimir una fecha inventada", () => {
    const html = render({ planStatus: "past_due", graceUntil: null });
    expect(html).toContain("billing-banner");
    expect(html).not.toContain("Invalid Date");
    expect(html).not.toContain("null");
  });

  it("lleva role=alert para que el lector de pantalla lo anuncie", () => {
    expect(render({ planStatus: "past_due", graceUntil: null })).toContain('role="alert"');
  });
});
