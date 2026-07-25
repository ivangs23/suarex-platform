export type { PrinterConfig, PrintResult } from "./adapters/types.js";
export {
  aggregateStatus,
  createPrinterHealth,
  DEFAULT_STALE_AFTER_MS,
  type PrinterHealth,
  type PrinterStatus,
  stillFresh,
} from "./health.js";
export { deviceKey, printToPrinter } from "./print-order.js";
export { type ProbeResult, probeTcp } from "./probe-tcp.js";
export { enqueueByDevice } from "./queue.js";
export { renderEscPos } from "./render.js";
export type { UsbRawSink } from "./usb-sink.js";
export { registerUsbRawSink } from "./usb-sink.js";
