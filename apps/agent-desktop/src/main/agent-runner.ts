import { runAgent } from "@suarex/agent";
import { registerUsbRawSink } from "@suarex/printing";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./baked-config.js";
import type { StoredCredentials } from "./config-store.js";
import { loadWinspoolBinding, makeUsbSink } from "./usb-sink-winspool.js";

let stop: (() => void) | null = null;

/** Arranca el agente con las credenciales guardadas: registra el sink USB real (solo en
 * Windows; en otra plataforma el sink por defecto de `@suarex/printing` ya falla limpio y el
 * agente solo podría imprimir por red) y llama a `runAgent`. Guarda la función de parada. */
export async function startAgent(creds: StoredCredentials): Promise<void> {
  // Para un agente ya en marcha antes de arrancar otro (p. ej. re-emparejar sin
  // des-emparejar): sin esto, la función de parada anterior se perdería y quedaría un
  // segundo agente vivo -- subs de Realtime duplicadas y, peor, tickets impresos dos veces.
  stopAgent();
  if (process.platform === "win32") {
    registerUsbRawSink(makeUsbSink(await loadWinspoolBinding()));
  }
  stop = await runAgent({
    supabaseUrl: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    email: creds.email,
    password: creds.password,
  });
}

/** Detiene el agente si está corriendo (lo llama el cierre de la app / el des-emparejar). */
export function stopAgent(): void {
  if (stop) {
    stop();
    stop = null;
  }
}

export function isAgentRunning(): boolean {
  return stop !== null;
}
