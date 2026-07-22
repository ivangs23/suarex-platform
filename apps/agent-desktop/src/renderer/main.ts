import type { OpenAdminResult } from "../main/admin-window.js";
import type { PairIpcResult } from "../main/ipc.js";

type AgentApi = {
  listPrinters(): Promise<string[]>;
  pair(code: string): Promise<PairIpcResult>;
  testPrint(printerName: string): Promise<{ ok: boolean }>;
  getStatus(): Promise<{ paired: boolean; running: boolean; deviceId: string | null }>;
  unpair(): Promise<{ ok: boolean }>;
  openAdmin(): Promise<OpenAdminResult>;
};
const agent = (window as unknown as { agent: AgentApi }).agent;

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const logEl = $("log");
function log(msg: string): void {
  logEl.textContent += `${new Date().toLocaleTimeString()}  ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

async function refreshStatus(): Promise<void> {
  const s = await agent.getStatus();
  $("status").textContent =
    `Estado: ${s.paired ? "emparejado" : "sin emparejar"} · agente ${s.running ? "corriendo" : "parado"}${s.deviceId ? ` · dispositivo ${s.deviceId}` : ""}`;
}

async function refreshPrinters(): Promise<void> {
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

$("pair").addEventListener("click", async () => {
  const code = ($("code") as HTMLInputElement).value.trim();
  if (!code) return;
  try {
    const r = await agent.pair(code);
    if (r.ok) {
      log(`Emparejado: dispositivo ${r.deviceId}, tenant ${r.tenantId}`);
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

void refreshStatus();
void refreshPrinters();

// La gestión de la carta se abre en su propia ventana con el panel web de la plataforma
// (ver `admin-window.ts`): mismas validaciones y mismos permisos que en el navegador, y la
// sesión es de la PERSONA que entra, no del dispositivo -- que solo puede imprimir.
$("admin").addEventListener("click", async () => {
  const r = await agent.openAdmin();
  if (r.ok) {
    log("Gestión de catálogo abierta. Inicia sesión con tu cuenta de owner o admin.");
    return;
  }
  log(
    "No se puede abrir la gestión: este instalador se generó sin PLATFORM_WEB_ORIGIN, " +
      "así que no sabe a qué plataforma conectarse. Hay que reconstruirlo con esa variable.",
  );
});
