import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { strings } from "@/lib/i18n";
import { CartProvider } from "./CartProvider";
import { ScanToOrderHint } from "./ScanToOrderHint";

/**
 * El aviso de "escanea el QR para pedir" es plataforma: lo monta la página para TODOS los
 * clientes cuando ese navegador no puede pedir. Sin él, la carta se queda muda en modo
 * consulta y quien está sentado no entiende por qué le faltan los botones.
 */
const render = (canOrder: boolean) =>
  renderToStaticMarkup(
    <CartProvider locale="es" currency="EUR" canOrder={canOrder} strings={strings("es")}>
      <ScanToOrderHint />
    </CartProvider>,
  );

describe("ScanToOrderHint", () => {
  it("avisa de escanear el QR cuando no se puede pedir", () => {
    const html = render(false);

    expect(html).toContain('data-testid="scan-to-order"');
    expect(html).toContain("Escanea el QR de tu mesa para pedir");
  });

  it("no se entromete cuando sí se puede pedir", () => {
    // Con la mesa escaneada el comensal ya tiene botón de pedido y de añadir: repetir el
    // aviso solo sería ruido sobre la carta.
    expect(render(true)).not.toContain('data-testid="scan-to-order"');
  });
});
