import type { TicketLine } from "@suarex/ticket";
import { CharacterSet, PrinterTypes, ThermalPrinter } from "node-thermal-printer";

/**
 * Renderiza las líneas a bytes ESC/POS SIN abrir ninguna conexión: se construye
 * un ThermalPrinter con una interfaz ficticia y se pide `getBuffer()`. La entrega
 * la hace el adaptador. Charset PC858_EURO para conservar el símbolo del euro.
 */
export function renderEscPos(lines: TicketLine[]): Buffer {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: "tcp://127.0.0.1:9100",
    characterSet: CharacterSet.PC858_EURO,
    removeSpecialCharacters: false,
  });

  for (const line of lines) {
    if (line.kind === "text") {
      printer.alignCenter();
      if (line.align === "left") printer.alignLeft();
      if (line.align === "right") printer.alignRight();
      printer.bold(Boolean(line.bold));
      printer.setTextSize(line.size === 2 ? 1 : 0, line.size === 2 ? 1 : 0);
      printer.println(line.text);
      printer.setTextSize(0, 0);
      printer.bold(false);
    } else if (line.kind === "divider") {
      printer.drawLine();
    } else if (line.kind === "newline") {
      printer.newLine();
    } else if (line.kind === "cut") {
      printer.cut();
    }
  }

  return printer.getBuffer();
}
