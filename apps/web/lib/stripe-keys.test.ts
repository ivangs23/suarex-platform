import { describe, expect, it } from "vitest";
import { pickStripeKeys } from "./stripe-keys";

/**
 * Lo que se prueba aquí es dónde acaba el dinero.
 *
 * El fallo que hay que hacer imposible no es "no cobrar" -- eso se ve enseguida -- sino MEZCLAR:
 * crear el cobro con la clave secreta de un cliente y montar el formulario con la pública de otra
 * cuenta. Eso produce un cobro que no se puede confirmar y, si alguna vez las cuentas coincidieran
 * mal, dinero en el sitio equivocado.
 */

const NADA = { secretKey: null, publishableKey: null, webhookSecret: null };
const ENTORNO = {
  secretKey: "sk_entorno",
  publishableKey: "pk_entorno",
  webhookSecret: "whsec_entorno",
};
const PROPIAS = {
  secretKey: "sk_cliente",
  publishableKey: "pk_cliente",
  webhookSecret: "whsec_cliente",
};

describe("cuando el cliente tiene sus credenciales", () => {
  it("se cobra con las suyas, enteras", () => {
    expect(pickStripeKeys(PROPIAS, ENTORNO)).toEqual({ kind: "tenant", keys: PROPIAS });
  });

  it("NINGUNA clave del entorno se cuela", () => {
    // El control que importa: si se colara la pública del entorno, el cobro no se confirmaría.
    const elegidas = pickStripeKeys(PROPIAS, ENTORNO);
    expect(JSON.stringify(elegidas)).not.toContain("entorno");
  });

  it("sin secreto de webhook propio no se hereda el del entorno", () => {
    /* El secreto del webhook pertenece a la MISMA cuenta que la clave secreta. Heredarlo del
       entorno haría fallar la verificación de firma de todos sus eventos, y los pedidos no se
       marcarían pagados: cobrados y sin comanda. */
    const sinWebhook = { ...PROPIAS, webhookSecret: null };
    const elegidas = pickStripeKeys(sinWebhook, ENTORNO);
    expect(elegidas).toMatchObject({ kind: "tenant" });
    if (elegidas.kind === "tenant") expect(elegidas.keys.webhookSecret).toBeNull();
  });

  it("falta el secreto del webhook: se cobra igual, porque el problema es de otro momento", () => {
    // Bloquear la venta por algo que fallará DESPUÉS dejaría al negocio sin vender por adelantado.
    expect(pickStripeKeys({ ...PROPIAS, webhookSecret: null }, ENTORNO).kind).toBe("tenant");
  });
});

describe("el caso peligroso: credenciales a medias", () => {
  it("con clave secreta y SIN pública se declara incompleta, no se cae al entorno", () => {
    /* Caer al entorno aquí sería justo la mezcla prohibida: cobro creado en la cuenta del cliente
       y formulario montado contra la de la plataforma. */
    const aMedias = { ...PROPIAS, publishableKey: null };
    expect(pickStripeKeys(aMedias, ENTORNO)).toEqual({
      kind: "incompleta",
      missing: ["clave pública"],
    });
  });

  it("con clave pública y SIN secreta se ignora la suya y se cobra con el entorno", () => {
    /* Sin la secreta no se puede cobrar en su cuenta, así que su pública no sirve para nada aquí.
       Usarla con la secreta del entorno sería la misma mezcla al revés. */
    const soloPublica = { ...NADA, publishableKey: "pk_cliente" };
    expect(pickStripeKeys(soloPublica, ENTORNO)).toEqual({ kind: "entorno", keys: ENTORNO });
  });
});

describe("mientras el cliente no tenga las suyas", () => {
  it("se cobra con el entorno, como hasta ahora", () => {
    expect(pickStripeKeys(NADA, ENTORNO)).toEqual({ kind: "entorno", keys: ENTORNO });
  });

  it("sin entorno y sin cliente, se dice qué falta en vez de reventar", () => {
    expect(pickStripeKeys(NADA, NADA)).toEqual({
      kind: "incompleta",
      missing: ["clave secreta", "clave pública"],
    });
  });

  it("el entorno sin secreto de webhook sigue sirviendo para cobrar", () => {
    const sinWebhook = { ...ENTORNO, webhookSecret: null };
    expect(pickStripeKeys(NADA, sinWebhook).kind).toBe("entorno");
  });
});

describe("cadenas en blanco", () => {
  it("cuentan como ausencia, no como credencial", () => {
    // Una clave "  " pasaría cualquier comprobación de presencia y fallaría al llamar a Stripe.
    const enBlanco = { secretKey: "   ", publishableKey: "", webhookSecret: "  " };
    expect(pickStripeKeys(enBlanco, ENTORNO)).toEqual({ kind: "entorno", keys: ENTORNO });
  });

  it("se recortan los espacios de las que sí valen", () => {
    const conEspacios = { secretKey: " sk_x ", publishableKey: " pk_x ", webhookSecret: null };
    const elegidas = pickStripeKeys(conEspacios, ENTORNO);
    expect(elegidas).toMatchObject({
      kind: "tenant",
      keys: { secretKey: "sk_x", publishableKey: "pk_x" },
    });
  });
});
