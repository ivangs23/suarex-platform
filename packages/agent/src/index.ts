// Re-export del tipo del cliente Supabase para que la cáscara Electron (`apps/agent-desktop`) lo
// use SIN importar `@supabase/supabase-js` directamente -- la regla `noRestrictedImports` reserva
// ese import a `packages/db`, y el desktop ya habla con Supabase solo a través de este paquete.
export type { SupabaseClient } from "@supabase/supabase-js";
export type { AgentCredentials, SessionStore } from "./agent-client.js";
export {
  createDeviceClient,
  DEVICE_SESSION_STORAGE_KEY,
  signInAndPersistSession,
} from "./agent-client.js";
export { unprintedPaidOrdersForDevice } from "./device-orders.js";
export type {
  AgentHandle,
  AgentTickResult,
  NetworkPrinterProbe,
  PrintFailure,
} from "./run-agent.js";
export { probeNetworkPrinters, runAgent, runAgentTick } from "./run-agent.js";
