import { filterItems } from "./routing.js";
import { sanitizeForThermal } from "./sanitize.js";
import type { TicketBranding, TicketDestination, TicketLine, TicketOrder } from "./types.js";

const DEST_LABELS: Record<TicketDestination, string> = {
  cocina: "COCINA",
  barra: "BARRA",
  all: "TODOS",
};

function formatHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

export function buildTicketLines(
  order: TicketOrder,
  branding: TicketBranding,
  destination: TicketDestination,
): TicketLine[] {
  const items = destination === "all" ? order.items : filterItems(order.items, destination);

  const lines: TicketLine[] = [
    {
      kind: "text",
      text: sanitizeForThermal(branding.header),
      align: "center",
      bold: true,
      size: 2,
    },
    { kind: "divider" },
    { kind: "text", text: DEST_LABELS[destination], align: "center", bold: true, size: 2 },
    order.tableLabel
      ? { kind: "text", text: `MESA ${order.tableLabel}`, align: "left", bold: true }
      : { kind: "text", text: "PARA LLEVAR", align: "left", bold: true },
    { kind: "text", text: `Hora: ${formatHHMM(order.createdAt)}`, align: "left" },
    { kind: "divider" },
  ];

  if (items.length === 0) {
    lines.push({
      kind: "text",
      text: `Sin items para ${DEST_LABELS[destination]}`,
      align: "center",
    });
  } else {
    for (const item of items) {
      lines.push({
        kind: "text",
        text: `${item.quantity}x  ${sanitizeForThermal(item.name)}`,
        align: "left",
      });
      for (const extra of item.extras) {
        lines.push({ kind: "text", text: `   + ${sanitizeForThermal(extra)}`, align: "left" });
      }
    }
  }

  lines.push(
    { kind: "divider" },
    { kind: "text", text: `Pedido #${order.orderNumber}`, align: "center" },
    { kind: "newline" },
    { kind: "cut" },
  );

  return lines;
}
