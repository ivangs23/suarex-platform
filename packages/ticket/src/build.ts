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
      /* La nota del comensal, en NEGRITA y pegada a su línea.
       *
       * El campo se llama "Notas para la cocina" en la carta, se guardaba bien... y no se
       * imprimía. O sea que quien escribía "sin gluten" o "alergia a los frutos secos" veía que
       * lo recogían y la cocina no se enteraba nunca. Va antes que las extras porque puede ser
       * un dato de seguridad, y destacada porque en una comanda de veinte líneas el texto plano
       * se pasa por alto. */
      if (item.notes) {
        lines.push({
          kind: "text",
          text: `   >> ${sanitizeForThermal(item.notes)}`,
          align: "left",
          bold: true,
        });
      }
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
