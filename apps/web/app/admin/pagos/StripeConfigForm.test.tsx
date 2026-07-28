import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StripeConfigForm } from "./StripeConfigForm";

/**
 * La regla que este formulario NO puede romper: un secreto guardado no vuelve al navegador.
 *
 * La clave pública sí -- su trabajo es bajar y montar el formulario de tarjeta. Confundir las dos
 * es la diferencia entre una pantalla de ajustes y una filtración.
 */
describe("StripeConfigForm", () => {
  const pinta = (props: Partial<Parameters<typeof StripeConfigForm>[0]> = {}) =>
    renderToStaticMarkup(<StripeConfigForm publishableKey="" secretsSet={[]} {...props} />);

  it("la clave pública se rellena con lo guardado", () => {
    expect(pinta({ publishableKey: "pk_test_visible" })).toContain('value="pk_test_visible"');
  });

  /** La etiqueta `<input>` de un campo, sin suponer en qué orden pinta React los atributos. */
  const campo = (html: string, name: string) =>
    html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";

  it("los secretos se pintan como contraseña y SIN valor", () => {
    const html = pinta({ secretsSet: ["secretKey", "webhookSecret"] });

    for (const name of ["secretKey", "webhookSecret"]) {
      const input = campo(html, name);
      expect(input, `no se encontró el campo ${name}`).not.toBe("");
      expect(input).toContain('type="password"');
      // Ni siquiera un `value` vacío: el valor sencillamente no existe en este componente.
      expect(input).not.toMatch(/value="/);
    }
  });

  it("la clave pública SÍ lleva valor, que es la diferencia con un secreto", () => {
    // Control positivo del test de arriba: si ningún campo llevara valor nunca, no probaría nada.
    const html = pinta({ publishableKey: "pk_test_visible" });
    expect(campo(html, "publishable_key")).toContain('value="pk_test_visible"');
  });

  it("de un secreto guardado solo se dice que lo está", () => {
    const html = pinta({ secretsSet: ["secretKey"] });
    expect(html).toContain("guardada");
    // Y el que NO está guardado no lo dice: enseña qué forma tiene el dato que falta.
    expect(html).toContain("whsec_");
  });

  it("avisa de lo que pasa si falta el secreto del webhook", () => {
    /* Es el que se olvida, y su olvido no se nota al cobrar -- se nota en la cocina. Que la
       pantalla lo diga es más barato que descubrirlo con un comensal pagado y sin comanda. */
    expect(pinta()).toContain("no llegarían a marcarse pagados");
  });
});
