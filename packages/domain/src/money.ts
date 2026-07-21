export type Cents = number;

export function eurosToCents(euros: number): Cents {
  if (!Number.isFinite(euros) || euros < 0) {
    throw new Error(`Importe inválido: ${euros}`);
  }
  return Math.round(euros * 100);
}

export function centsToEuros(cents: Cents): number {
  return Math.round(cents) / 100;
}

export function formatCents(cents: Cents, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(centsToEuros(cents));
}
