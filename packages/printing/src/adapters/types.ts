type PrinterBase = {
  id: string;
  label: string;
  destination: "cocina" | "barra" | "all";
};

export type PrinterConfig =
  | (PrinterBase & { adapter: "escpos-tcp"; host: string; port: number })
  | (PrinterBase & { adapter: "escpos-usb"; printerName: string });

export type PrintResult = { id: string; label: string; ok: boolean; reason?: string };
