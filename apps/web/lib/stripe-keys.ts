/**
 * CON QUÉ CUENTA DE STRIPE SE COBRA UN PEDIDO.
 *
 * Cada cliente tiene su PROPIA cuenta, independiente. Mientras no tenga credenciales guardadas se
 * sigue cobrando con las del entorno -- que es como funcionaba antes -- para que nadie deje de
 * cobrar el día del despliegue.
 *
 * La regla es TODO O NADA, y es lo único importante de este fichero: si un cliente tiene su clave
 * secreta, se usan SOLO las suyas. Mezclar es el error que hay que hacer imposible -- la clave
 * pública y la secreta identifican la MISMA cuenta, así que crear el cobro con la secreta de un
 * cliente y montar el formulario con la pública de otra cuenta produce un cobro que no se puede
 * confirmar. Y en el peor caso, si alguna vez coincidieran, dinero en la cuenta equivocada.
 *
 * Por eso un cliente con clave secreta pero sin clave pública NO cae al entorno: se declara mal
 * configurado. Caer ahí sería exactamente la mezcla que esto existe para evitar.
 */

export type StripeKeys = {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string | null;
};

export type StripeKeyChoice =
  | { kind: "tenant"; keys: StripeKeys }
  | { kind: "entorno"; keys: StripeKeys }
  /** Falta algo para poder cobrar, y decirlo es mejor que cobrar con la cuenta de otro. */
  | { kind: "incompleta"; missing: string[] };

type Credenciales = {
  secretKey: string | null;
  publishableKey: string | null;
  webhookSecret: string | null;
};

const texto = (valor: string | null | undefined): string | null => {
  const limpio = (valor ?? "").trim();
  return limpio === "" ? null : limpio;
};

/**
 * Elige las claves con las que cobrar. Pura: recibe las del cliente y las del entorno.
 *
 * `webhookSecret` puede faltar sin impedir el cobro -- se cobra igual; lo que no ocurre es que el
 * pedido se marque pagado. Es un problema grave pero de OTRO momento (el webhook), así que no se
 * bloquea aquí: bloquear el cobro por eso dejaría al negocio sin vender por algo que todavía no
 * ha pasado.
 */
export function pickStripeKeys(tenant: Credenciales, entorno: Credenciales): StripeKeyChoice {
  const propias = {
    secretKey: texto(tenant.secretKey),
    publishableKey: texto(tenant.publishableKey),
    webhookSecret: texto(tenant.webhookSecret),
  };

  // La clave SECRETA es la que decide la cuenta: si el cliente tiene la suya, manda entera.
  if (propias.secretKey) {
    if (!propias.publishableKey) {
      return { kind: "incompleta", missing: ["clave pública"] };
    }
    return {
      kind: "tenant",
      keys: {
        secretKey: propias.secretKey,
        publishableKey: propias.publishableKey,
        webhookSecret: propias.webhookSecret,
      },
    };
  }

  /* Sin clave secreta propia, la pública que tenga da igual: sin la secreta no se puede cobrar en
     su cuenta, y usar su pública con la secreta del entorno sería la mezcla prohibida. Se ignora
     y se cobra con el entorno, como hasta ahora. */
  const delEntorno = {
    secretKey: texto(entorno.secretKey),
    publishableKey: texto(entorno.publishableKey),
    webhookSecret: texto(entorno.webhookSecret),
  };

  const faltan: string[] = [];
  if (!delEntorno.secretKey) faltan.push("clave secreta");
  if (!delEntorno.publishableKey) faltan.push("clave pública");
  if (faltan.length > 0) return { kind: "incompleta", missing: faltan };

  return {
    kind: "entorno",
    keys: {
      secretKey: delEntorno.secretKey as string,
      publishableKey: delEntorno.publishableKey as string,
      webhookSecret: delEntorno.webhookSecret,
    },
  };
}
