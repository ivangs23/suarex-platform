import { runAgent } from "@suarex/agent";
import { registerUsbRawSink } from "@suarex/printing";
import {
  type ActivityAlerts,
  type AgentActivity,
  INITIAL_ACTIVITY,
  reduceActivity,
} from "./agent-activity.js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./baked-config.js";
import type { StoredCredentials } from "./config-store.js";
import { loadWinspoolBinding, makeUsbSink } from "./usb-sink-winspool.js";

let stop: (() => void) | null = null;
let activity: AgentActivity = INITIAL_ACTIVITY;
let appVersion: string | undefined;
let printersProvider: (() => string[] | Promise<string[]>) | undefined;

/** La cáscara Electron (`index.ts`) fija aquí `app.getVersion()` antes de arrancar el agente,
 *  para que el heartbeat reporte la build en marcha. Fuera de aquí para no meter `electron` en
 *  este módulo, que se testea headless. */
export function setAppVersion(version: string): void {
  appVersion = version;
}

/** La cáscara Electron inyecta aquí cómo enumerar las impresoras del SO (`getPrintersAsync`
 *  vía la ventana), para reportarlas en el heartbeat. Fuera de aquí por lo mismo que
 *  `setAppVersion`: `electron` no entra en este módulo, que se testea headless. */
export function setPrintersProvider(fn: () => string[] | Promise<string[]>): void {
  printersProvider = fn;
}

/** Quien quiera enterarse de cada tick (la cáscara Electron: pinta el estado y avisa de una
 *  impresora caída). Fuera de aquí para no meter `electron` en este módulo, que se testea
 *  headless. `nowIso` se inyecta para no depender del reloj en las pruebas. */
type ActivityListener = (activity: AgentActivity, alerts: ActivityAlerts) => void;
let listener: ActivityListener | null = null;

export function onAgentActivity(fn: ActivityListener): void {
  listener = fn;
}

export function getActivity(): AgentActivity {
  return activity;
}

/** Arranca el agente con las credenciales guardadas: registra el sink USB real (solo en
 * Windows; en otra plataforma el sink por defecto de `@suarex/printing` ya falla limpio y el
 * agente solo podría imprimir por red) y llama a `runAgent`. Guarda la función de parada. */
export async function startAgent(creds: StoredCredentials): Promise<void> {
  // Para un agente ya en marcha antes de arrancar otro (p. ej. re-emparejar sin
  // des-emparejar): sin esto, la función de parada anterior se perdería y quedaría un
  // segundo agente vivo -- subs de Realtime duplicadas y, peor, tickets impresos dos veces.
  stopAgent();
  activity = INITIAL_ACTIVITY;
  if (process.platform === "win32") {
    registerUsbRawSink(makeUsbSink(await loadWinspoolBinding()));
  }
  stop = await runAgent(
    {
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      email: creds.email,
      password: creds.password,
      // Para el canal de Realtime (vía rápida ante un pedido nuevo). El aislamiento lo da RLS.
      tenantId: creds.tenantId,
    },
    {
      appVersion,
      getPrinters: printersProvider,
      onTick: (result) => {
        const next = reduceActivity(activity, result, new Date().toISOString());
        activity = next.activity;
        listener?.(next.activity, next.alerts);
      },
    },
  );
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
