export type PrinterConfig = {
  id: string;
  label: string;
  destination: "cocina" | "barra" | "all";
  adapter: "escpos-tcp";
  host: string;
  port: number;
};

export type PrintResult = { id: string; label: string; ok: boolean; reason?: string };
