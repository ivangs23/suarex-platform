import type { AgentActivity } from "../main/agent-activity.js";
import type { PairIpcResult } from "../main/ipc.js";
import type { ShowWebPanelResult } from "../main/web-panel.js";
import { setupNavigation } from "./navigation.js";

type AgentStatus = {
  paired: boolean;
  running: boolean;
  deviceId: string | null;
  platform: string;
  activity: AgentActivity;
};

type AgentApi = {
  listPrinters(): Promise<string[]>;
  pair(code: string): Promise<PairIpcResult>;
  testPrint(printerName: string): Promise<{ ok: boolean }>;
  getStatus(): Promise<AgentStatus>;
  confirmUnpair(): Promise<boolean>;
  unpair(): Promise<{ ok: boolean }>;
  showSection(section: string): Promise<ShowWebPanelResult>;
  onActivity(cb: (activity: AgentActivity) => void): () => void;
};

/**
 * El puente lo instala el preload (contextBridge). Puede faltar en dos situaciones reales:
 * si el preload falla al cargar, y al abrir este mismo HTML en un navegador para revisar
 * los estilos. En ambas, una app que revienta con "cannot read property of undefined" y se
 * queda en blanco no dice nada útil; degradar deja la interfaz visible y explica qué pasa.
 */
const agent = (window as unknown as { agent?: AgentApi }).agent ?? null;

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const logEl = $("log");

function log(msg: string): void {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setDisabled(ids: string[], disabled: boolean): void {
  for (const id of ids) ($(id) as HTMLButtonElement).disabled = disabled;
}

/**
 * Pinta el estado. Tres estados con significado distinto, y el color NUNCA va solo: el
 * título dice lo mismo en palabras, porque en torno al 8% de los hombres no distingue rojo
 * de verde y este es justo el dato por el que se abre la app.
 */
function renderStatus(status: AgentStatus): void {
  const state = status.running ? "running" : status.paired ? "paired" : "idle";
  $("status").dataset.state = state;

  const titulo =
    state === "running"
      ? "Imprimiendo pedidos"
      : state === "paired"
        ? "Emparejado, agente parado"
        : "Sin emparejar";

  const detalle =
    state === "running"
      ? `Dispositivo ${status.deviceId}. Puedes cerrar esta ventana: sigue funcionando en segundo plano.`
      : state === "paired"
        ? `Dispositivo ${status.deviceId}. Reinicia la aplicación si no vuelve a arrancar solo.`
        : "Introduce el código de emparejamiento que genera el panel de administración.";

  $("status-title").textContent = titulo;
  $("status-detail").textContent = detalle;

  // Sin emparejar no hay nada que des-emparejar. Deshabilitarlo evita el clic que solo
  // produce un error.
  setDisabled(["unpair"], !status.paired);

  // La impresión USB usa winspool: fuera de Windows no hay nada que listar ni a donde
  // imprimir, así que se avisa y se desactivan en vez de dejar que falle al pulsar.
  const esWindows = status.platform === "win32";
  ($("platform-note") as HTMLElement).hidden = esWindows;
  setDisabled(["refresh", "test"], !esWindows);
}

const DESTINO_NOMBRE: Record<string, string> = {
  cocina: "cocina",
  barra: "barra",
  all: "cocina y barra",
};

/**
 * Pinta el estado de impresión: cuántos tickets van y, sobre todo, un banner rojo si algo va
 * mal (impresora caída o sin conexión). Es lo que convierte la app de caja negra en algo que
 * el owner puede mirar y saber si la cocina está recibiendo las comandas.
 */
function renderActivity(a: AgentActivity): void {
  const summary = $("activity-summary");
  if (!a.lastTickAt) {
    summary.textContent = "Aún no ha llegado ningún pedido.";
  } else {
    const hora = new Date(a.lastTickAt).toLocaleTimeString();
    const n = a.printedTotal;
    const impresos = `${n} ticket${n === 1 ? "" : "s"} impreso${n === 1 ? "" : "s"}`;
    const fallos = a.failedTotal > 0 ? ` · ${a.failedTotal} con problemas` : "";
    summary.textContent = `${impresos}${fallos}. Última comprobación a las ${hora}.`;
  }

  const alerta = $("activity-alert");
  if (a.lastError) {
    alerta.textContent = "Sin conexión con la plataforma. Reintentando automáticamente.";
    alerta.hidden = false;
  } else if (a.downPrinters.length > 0) {
    const destinos = [
      ...new Set(a.downPrinters.map((p) => DESTINO_NOMBRE[p.destination] ?? p.destination)),
    ];
    alerta.textContent = `Impresora de ${destinos.join(" y ")} sin responder. Comprueba que esté encendida y conectada.`;
    alerta.hidden = false;
  } else {
    alerta.hidden = true;
    alerta.textContent = "";
  }
}

function renderSinPuente(): void {
  $("status").dataset.state = "error";
  $("status-title").textContent = "No se pudo iniciar";
  $("status-detail").textContent =
    "El puente interno de la aplicación no está disponible. Cierra y vuelve a abrirla; si sigue igual, reinstálala.";
  setDisabled(["pair", "unpair", "refresh", "test"], true);
}

async function refreshStatus(): Promise<void> {
  if (!agent) return;
  const status = await agent.getStatus();
  renderStatus(status);
  renderActivity(status.activity);
}

async function refreshPrinters(): Promise<void> {
  if (!agent) return;
  const printers = await agent.listPrinters();
  const sel = $("printers") as HTMLSelectElement;
  sel.innerHTML = "";
  for (const name of printers) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  log(`Impresoras detectadas: ${printers.length ? printers.join(", ") : "(ninguna)"}`);
}

// Navegación. Se instala FUERA de la comprobación del puente a propósito: cambiar de
// sección es interfaz pura y tiene que funcionar aunque el IPC no esté disponible (ver el
// docstring de `setupNavigation` y su test de regresión).
//
// Productos y Pedidos los pinta una vista incrustada del panel de la plataforma
// (`main/web-panel.ts`), que se superpone a esta zona: mismas validaciones y mismos
// permisos que en el navegador, y la sesión es de la PERSONA que entra, no del dispositivo
// -- que solo puede imprimir. Config e Impresoras son locales.
const { irA } = setupNavigation(document, agent ? (s) => agent.showSection(s) : undefined);
void irA("config");

if (!agent) {
  renderSinPuente();
} else {
  $("pair").addEventListener("click", async () => {
    const code = ($("code") as HTMLInputElement).value.trim();
    if (!code) {
      log("Escribe primero el código de emparejamiento.");
      return;
    }
    try {
      const r = await agent.pair(code);
      if (r.ok) {
        log(`Emparejado: dispositivo ${r.deviceId}, tenant ${r.tenantId}`);
        ($("code") as HTMLInputElement).value = "";
        await refreshStatus();
      } else {
        const msg =
          r.kind === "invalid-code"
            ? "código inválido o caducado"
            : r.kind === "rate-limited"
              ? "demasiados intentos, espera"
              : "fallo de red";
        log(`Error al emparejar: ${msg}`);
      }
    } catch (e) {
      // Fallo inesperado (no un PairError discriminado): p.ej. no se pudo guardar la
      // credencial o arrancar el agente tras un emparejamiento válido.
      log(`Error inesperado al emparejar: ${(e as Error).message}`);
    }
  });

  $("unpair").addEventListener("click", async () => {
    // Confirmación nativa: des-emparejar corta la impresión hasta re-emparejar.
    if (!(await agent.confirmUnpair())) return;
    await agent.unpair();
    log("Des-emparejado.");
    await refreshStatus();
  });

  $("refresh").addEventListener("click", refreshPrinters);

  $("test").addEventListener("click", async () => {
    const name = ($("printers") as HTMLSelectElement).value;
    if (!name) {
      log("Selecciona una impresora primero.");
      return;
    }
    log(`Imprimiendo ticket de prueba en "${name}"…`);
    try {
      await agent.testPrint(name);
      log("Ticket de prueba enviado. ¿Salió por la impresora?");
    } catch (e) {
      log(`Error al imprimir la prueba: ${(e as Error).message}`);
    }
  });

  // Empuje en vivo: cada tick del agente repinta el estado de impresión sin sondear.
  agent.onActivity(renderActivity);

  void refreshStatus();
  void refreshPrinters();
}
