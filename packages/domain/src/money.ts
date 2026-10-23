export type Cents = number;

export function eurosToCents(euros: number): Cents {
  if (!Number.isFinite(euros) || euros < 0) {
    throw new Error(`Importe inválido: ${euros}`);
  }
  // Normaliza -0 a 0: euros === -0 no dispara la guarda de arriba (-0 < 0 es
  // false), pero Math.round(-0 * 100) conserva el signo y formatCents lo
  // mostraría como "-0,00 €".
  return Math.round(euros * 100) + 0;
}

export function centsToEuros(cents: Cents): number {
  // Misma normalización que en eurosToCents: si cents ya es -0 (o algún
  // cálculo aguas arriba lo produce), evita propagar el signo hasta el
  // formateo.
  return Math.round(cents) / 100 + 0;
}

/**
 * ¿El cobro es exactamente el total del pedido? La conversión vive aquí y en ningún otro sitio:
 * Stripe da céntimos y la moneda en minúsculas (`eur`); el pedido guarda euros (`numeric`) y la
 * moneda en mayúsculas (`EUR`).
 */
export function cobroCuadraConPedido(
  pedido: { totalEuros: number; currency: string },
  cobro: { amountCents: Cents; currency: string },
): boolean {
  return (
    eurosToCents(pedido.totalEuros) === cobro.amountCents &&
    pedido.currency.toLowerCase() === cobro.currency.toLowerCase()
  );
}

export function formatCents(cents: Cents, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(centsToEuros(cents));
}
