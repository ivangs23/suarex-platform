import type { PaymentProviderInfo } from "@suarex/payments";
import { PAYTEF_INFO } from "@suarex/payments";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentConfigForm } from "./PaymentConfigForm";

/**
 * EL OBJETIVO DE TODO ESTO, comprobado: añadir un método de pago no debe obligar a tocar la UI.
 *
 * Este test registra un proveedor INVENTADO, que no existe en el producto, y comprueba que el
 * formulario lo pinta entero -- sus campos, sus etiquetas, sus tipos. Si algún día alguien vuelve
 * a escribir los campos a mano en el componente, este test se cae, y con él la promesa de que un
 * proveedor nuevo es un fichero y no una tarde de pantallas.
 *
 * Se usa `renderToStaticMarkup` (mismo enfoque que el contrato de los temas): sin DOM ni eventos,
 * solo lo que sale pintado, que es exactamente lo que se quiere fijar.
 */

const INVENTADO: PaymentProviderInfo = {
  id: "banco-imaginario",
  label: "Banco Imaginario",
  canPollSession: false,
  configFields: [
    { name: "tienda", label: "Número de tienda", type: "text", required: true },
    { name: "apiKey", label: "Clave de API", type: "secret", required: true },
    { name: "sucursal", label: "Sucursal", type: "text", required: false },
    { name: "caja", label: "Caja física", type: "terminal", required: true },
  ],
};

function pinta(props: Partial<Parameters<typeof PaymentConfigForm>[0]> = {}) {
  return renderToStaticMarkup(
    <PaymentConfigForm
      providers={[INVENTADO, PAYTEF_INFO]}
      provider="banco-imaginario"
      config={{}}
      secretsSet={[]}
      mock={true}
      {...props}
    />,
  );
}

describe("PaymentConfigForm se pinta desde la declaración del proveedor", () => {
  it("un proveedor que este componente no conoce sale con todos sus campos", () => {
    const html = pinta();
    expect(html).toContain("Número de tienda");
    expect(html).toContain("Clave de API");
    expect(html).toContain("Sucursal");
    // Y con el nombre de campo que el proveedor declaró, que es como se recoge al guardar.
    expect(html).toContain('name="tienda"');
    expect(html).toContain('name="apiKey"');
  });

  it("los campos opcionales se marcan como tales, para no parecer obligatorios", () => {
    expect(pinta()).toContain("Sucursal (opcional)");
  });

  it("un secreto se pinta como contraseña, no como texto a la vista", () => {
    const html = pinta();
    expect(html).toMatch(/name="apiKey"[^>]*type="password"|type="password"[^>]*name="apiKey"/);
  });

  it("el terminal NO sale aquí: es del aparato, y se asigna en la ficha del dispositivo", () => {
    // Un comercio con dos totems tiene dos cajas físicas y una sola cuenta. Pedirlo en esta
    // pantalla obligaría a elegir cuál de los dos gana.
    const html = pinta();
    expect(html).not.toContain("Caja física");
    expect(html).not.toContain('name="caja"');
  });

  it("avisa cuando el proveedor no sabe recuperar un cobro interrumpido", () => {
    // Se dice al configurarlo, no el día que se va la luz.
    expect(pinta()).toContain("payment-no-poll");
  });

  it("con Paytef, que sí sabe, no se avisa de nada", () => {
    expect(pinta({ provider: "paytef" })).not.toContain("payment-no-poll");
  });

  it("los valores guardados se rellenan, pero un secreto guardado JAMÁS", () => {
    /* El valor del secreto no baja al navegador ni existe en este componente: lo único que se
       sabe es que está puesto, y eso se dice con un texto de ayuda, no con un valor. */
    const html = pinta({
      config: { tienda: "T-1", sucursal: "S-9" },
      secretsSet: ["apiKey"],
    });
    expect(html).toContain('value="T-1"');
    expect(html).toContain('value="S-9"');
    expect(html).toContain("guardada");
    expect(html).toMatch(/name="apiKey"[^>]*value=""|name="apiKey"(?![^>]*value="[^"]+")/);
  });

  it("sin ningún proveedor disponible lo dice, en vez de pintar un formulario vacío", () => {
    const html = renderToStaticMarkup(
      <PaymentConfigForm providers={[]} provider="" config={{}} secretsSet={[]} mock={true} />,
    );
    expect(html).toContain("No hay ningún método de pago disponible");
  });
});
