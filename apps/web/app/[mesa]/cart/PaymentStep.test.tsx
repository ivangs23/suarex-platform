import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PaymentStep } from "./PaymentStep";

// Lo que recibe el formulario de Stripe: es lo único que este test mira.
const recibidas = vi.hoisted(() => [] as unknown[]);

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: unknown }) => children,
  PaymentElement: ({ options }: { options?: unknown }) => {
    recibidas.push(options);
    return null;
  },
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock("@/lib/stripe-browser", () => ({ stripeFor: () => null }));
vi.mock("./CartProvider", () => ({
  useCart: () => ({
    pago: {
      publishableKey: "pk_test_x",
      clientSecret: "pi_x_secret_y",
      connectedAccount: null,
      publicToken: "tok",
    },
    strings: {
      payTitle: "Pagar",
      payBack: "Volver",
      payNow: "Pagar {total}",
      payProcessing: "Procesando",
      payError: "Error",
      orderError: "Error",
    },
    totalLabel: "18,00 €",
    cancelarPago: () => {},
  }),
}));

describe("PaymentStep", () => {
  it("no ofrece Link: pide el correo del comensal y no le llega nada", () => {
    recibidas.length = 0;
    renderToStaticMarkup(<PaymentStep />);

    expect(recibidas).toHaveLength(1);
    expect(recibidas[0]).toMatchObject({ wallets: { link: "never" } });
  });

  it("deja Apple Pay y Google Pay como los decida Stripe", () => {
    recibidas.length = 0;
    renderToStaticMarkup(<PaymentStep />);

    const wallets = (recibidas[0] as { wallets: Record<string, string> }).wallets;
    expect(wallets.applePay).toBeUndefined();
    expect(wallets.googlePay).toBeUndefined();
  });
});
