export type TicketDestination = "cocina" | "barra" | "all";

export type TicketLine =
  | { kind: "text"; text: string; align: "left" | "center" | "right"; bold?: boolean; size?: 1 | 2 }
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
