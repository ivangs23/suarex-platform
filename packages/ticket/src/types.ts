export type TicketDestination = "cocina" | "barra" | "all";

export type TicketLine =
  | { kind: "text"; text: string; align: "left" | "center" | "right"; bold?: boolean; size?: 1 | 2 }
  // Dos columnas en la MISMA línea: etiqueta a la izquierda, importe a la derecha. El relleno lo
  // calcula el driver con el ancho real de la impresora (`leftRight`), así que queda alineado
  // igual en papel de 58 o de 80 mm -- por eso el recibo no fija un número de columnas a mano.
  | { kind: "row"; left: string; right: string; bold?: boolean }
  | { kind: "divider" }
  | { kind: "newline" }
  | { kind: "cut" };

export type TicketItem = {
  name: string;
  quantity: number;
  destination: "cocina" | "barra" | null;
  extras: string[];
};

export type TicketOrder = {
  orderNumber: number;
  tableLabel: string | null;
  createdAt: string;
  items: TicketItem[];
};

export type TicketBranding = { header: string };

/**
 * Una línea del RECIBO DEL CLIENTE (a diferencia de la comanda, que no lleva dinero): un producto
 * con su total de línea ya en céntimos (unidad × cantidad, extras incluidas).
 */
export type ReceiptItem = {
  name: string;
  quantity: number;
  extras: string[];
  lineCents: number;
};

/**
 * El RECIBO que sale por la impresora del propio totem cuando se aprueba el cobro. Lleva lo que
 * la comanda no: precios, base, IVA, total y el código de recogida que el comensal vio en
 * pantalla. Los importes salen SIEMPRE del servidor (los relee el agente), nunca de la carta.
 */
export type ReceiptOrder = {
  orderNumber: number;
  tableLabel: string | null;
  createdAt: string;
  items: ReceiptItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  locale: string;
  /** Código de recogida, el MISMO que la pantalla de recogida del totem. */
  pickupCode: string;
};
