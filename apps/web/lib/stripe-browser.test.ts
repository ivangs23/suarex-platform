import { beforeEach, describe, expect, it, vi } from "vitest";

const loadStripe = vi.fn((_clave: string, _opts?: unknown) => Promise.resolve({} as unknown));
vi.mock("@stripe/stripe-js", () => ({ loadStripe: (c: string, o?: unknown) => loadStripe(c, o) }));

const { resetInstanciasStripe, stripeFor } = await import("./stripe-browser");

/**
 * LA RAMA DE STRIPE CONNECT.
 *
 * Si el tenant tiene cuenta conectada, el cargo se crea SOBRE ella y el dinero va al
 * restaurante en vez de a la plataforma. Esa es la rama que usa todo cliente real; la otra
 * -- cobrar contra la cuenta de plataforma -- es el respaldo de desarrollo y de un tenant sin
 * onboarding terminado.
 *
 * Un cargo directo sobre una cuenta conectada SOLO se puede confirmar si Stripe.js se
 * inicializó contra ESA misma cuenta. Si esto se rompe, el formulario de pago se pinta, el
 * comensal mete la tarjeta y falla al confirmar: para todos los clientes con Connect, y sin
 * que se note en desarrollo, donde no hay cuenta conectada.
 */
describe("stripeFor", () => {
  beforeEach(() => {
    loadStripe.mockClear();
    resetInstanciasStripe();
  });

  it("sin cuenta conectada carga contra la plataforma", () => {
    stripeFor("pk_test_x", null);
    expect(loadStripe).toHaveBeenCalledWith("pk_test_x", undefined);
  });

  it("con cuenta conectada inicializa Stripe.js CONTRA esa cuenta", () => {
    // Es la línea de la que depende que el cobro del restaurante se pueda confirmar.
    stripeFor("pk_test_x", "acct_123");
    expect(loadStripe).toHaveBeenCalledWith("pk_test_x", { stripeAccount: "acct_123" });
  });

  it("memoiza: dos llamadas iguales no recrean la instancia", () => {
    // `Elements` se re-montaría en cada render y perdería el formulario a medio rellenar.
    const a = stripeFor("pk_test_x", "acct_123");
    const b = stripeFor("pk_test_x", "acct_123");
    expect(a).toBe(b);
    expect(loadStripe).toHaveBeenCalledTimes(1);
  });

  it("la plataforma y una cuenta conectada NO comparten instancia", () => {
    // Si la memoización se hiciera solo por clave publicable, el segundo cobro reusaría la
    // instancia del primero y se confirmaría contra la cuenta equivocada -- o no se
    // confirmaría. Por eso la cuenta entra en la clave.
    stripeFor("pk_test_x", null);
    stripeFor("pk_test_x", "acct_123");
    expect(loadStripe).toHaveBeenCalledTimes(2);
  });

  it("dos cuentas conectadas distintas tampoco la comparten", () => {
    stripeFor("pk_test_x", "acct_aaa");
    stripeFor("pk_test_x", "acct_bbb");
    expect(loadStripe).toHaveBeenCalledTimes(2);
    expect(loadStripe).toHaveBeenLastCalledWith("pk_test_x", { stripeAccount: "acct_bbb" });
  });
});
