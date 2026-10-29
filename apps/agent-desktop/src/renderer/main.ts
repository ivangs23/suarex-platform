import type { TickPrinter } from "@suarex/agent";
import type { AgentActivity } from "../main/agent-activity.js";
import type {
  ExportDiagnosticsResult,
  PairIpcResult,
  ProbeNetworkPrintersResult,
} from "../main/ipc.js";
import type { ShowWebPanelResult } from "../main/web-panel.js";
import {
  type AgentStatus,
  type EstadoGeneral,
  estadoGeneral,
  nombreDeDestino,
  resumenDeImpresion,
} from "./estado.js";
import { setupNavigation } from "./navigation.js";
import { type Entrada, entradasDelRegistro, type Filtro, filtrar } from "./registro.js";

type AgentApi = {
  listPrinters(): Promise<string[]>;
  pair(code: string): Promise<PairIpcResult>;
  testPrint(printerName: string): Promise<{ ok: boolean }>;
  getStatus(): Promise<AgentStatus>;
  confirmUnpair(): Promise<boolean>;
  unpair(): Promise<{ ok: boolean }>;
  exportDiagnostics(): Promise<ExportDiagnosticsResult>;
  showLastDiagnostics(): Promise<boolean>;
  copyText(texto: string): Promise<boolean>;
  probeNetworkPrinters(): Promise<ProbeNetworkPrintersResult>;
  showSection(section: string): Promise<ShowWebPanelResult>;
  readLog(maxLines?: number): Promise<string[]>;
  onActivity(cb: (activity: AgentActivity) => void): () => void;
  onVolverAlMenu(cb: () => void): () => void;
  onEstadoCambiado(cb: () => void): () => void;
};

/**
 * El puente lo instala el preload (contextBridge). Puede faltar si el preload falla al cargar o
 * al abrir este HTML en un navegador para revisar los estilos: entonces la interfaz se queda
 * visible y explica qué pasa, en vez de quedarse en blanco.
 */
const agent = (window as unknown as { agent?: AgentApi }).agent ?? null;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/* --- Pequeños constructores de DOM. El texto entra siempre como texto, nunca como HTML: los
       nombres de impresora y las líneas del registro vienen de fuera. --------------------- */

const SVG = "http://www.w3.org/2000/svg";

function icono(id: string, clase = "icono"): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", clase);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#${id}`);
  svg.appendChild(use);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  ...hijos: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(tag);
  const { dataset, ...resto } = props;
  Object.assign(nodo, resto);
  if (dataset) Object.assign(nodo.dataset, dataset);
  for (const h of hijos) if (h !== null) nodo.append(h);
  return nodo;
}

function boton(
  texto: string,
  opciones: { icono?: string; clase?: string } = {},
): HTMLButtonElement {
  return el(
    "button",
    { type: "button", className: `boton ${opciones.clase ?? ""}`.trim() },
    opciones.icono ? icono(opciones.icono) : null,
    texto,
  );
}

/** Mientras dura una acción, el botón lo dice y no admite otro clic. */
async function conEspera<T>(
  b: HTMLButtonElement,
  texto: string,
  accion: () => Promise<T>,
): Promise<T> {
  const antes = [...b.childNodes];
  b.disabled = true;
  b.setAttribute("aria-busy", "true");
  b.textContent = texto;
  try {
    return await accion();
  } finally {
    b.replaceChildren(...antes);
    b.disabled = false;
    b.removeAttribute("aria-busy");
  }
}

/* --- Estado ------------------------------------------------------------------------------- */

let status: AgentStatus | null = null;
/** Cuándo empezó el corte de red en curso: el estado no lo anuncia hasta pasado un margen. */
let sinConexionDesde: number | null = null;

const ICONO_DE_NIVEL: Record<EstadoGeneral["nivel"], string> = {
  ok: "i-ok",
  aviso: "i-aviso",
  error: "i-error",
  neutro: "i-vincular",
};

function seguirCorteDeRed(activity: AgentActivity): void {
  if (!activity.lastError) sinConexionDesde = null;
  else if (sinConexionDesde === null) sinConexionDesde = Date.now();
}

function pintar(): void {
  if (!status) return;
  const estado = estadoGeneral(status, Date.now(), sinConexionDesde);

  $("pildora").dataset.nivel = estado.nivel;
  $("pildora-texto").textContent = estado.etiqueta;
  $("pildora").title = estado.titulo;

  $("estado").dataset.nivel = estado.nivel;
  $("estado-icono").setAttribute("href", `#${estado.icono ?? ICONO_DE_NIVEL[estado.nivel]}`);
  $("estado-titulo").textContent = estado.titulo;
  $("estado-detalle").textContent = estado.detalle;
  $("estado-acciones").replaceChildren(
    ...(estado.accion
      ? [
          el(
            "button",
            { type: "button", className: "boton", dataset: { irA: estado.accion.seccion } },
            estado.accion.texto,
          ),
        ]
      : []),
  );

  const sinVincular = !status.paired && (status.configFaltante ?? []).length === 0;
  $("vincular").hidden = !sinVincular;
  $("bloque-impresoras").hidden = !status.paired;

  const negocio = status.activity.businessName;
  $("negocio").textContent = negocio ?? (status.paired ? "Vinculado" : "Sin vincular");
  document.title = negocio ? `${negocio} · SuarEx Agente` : "SuarEx Agente";

  $("resumen").textContent = resumenDeImpresion(status);
  pintarImpresoras($("impresoras-estado"), false);
  pintarImpresoras($("impresoras-equipo"), true);
  pintarVinculacion();
  $("version").textContent = status.version ? `SuarEx Agente, versión ${status.version}` : "";

  const esWindows = status.platform === "win32";
  $("nota-plataforma").hidden = esWindows;
  $<HTMLButtonElement>("refrescar-windows").disabled = !esWindows;
}

/* --- Impresoras ----------------------------------------------------------------------------- */

/** Lo último que dijo la prueba de cada impresora, para que sobreviva a los repintados. */
const resultados = new Map<string, { tipo: "ok" | "error" | "info"; texto: string }>();

function estadoDeImpresora(p: TickPrinter): { clave: string; texto: string } {
  if (!status?.running) return { clave: "sin-datos", texto: "Sin datos" };
  if (status.activity.downPrinters.some((d) => d.printerId === p.id)) {
    return { clave: "caida", texto: "No responde" };
  }
  return { clave: "ok", texto: "Lista" };
}

function conexionDe(p: TickPrinter): Node {
  return p.conexion === "usb"
    ? el(
        "span",
        { className: "impresora-meta" },
        icono("i-usb"),
        `USB · ${p.printerName ?? "sin nombre"}`,
      )
    : el("span", { className: "impresora-meta" }, icono("i-red"), `Red · ${p.host}:${p.port}`);
}

function pintarImpresoras(lista: HTMLElement, conAcciones: boolean): void {
  if (!status) return;
  const impresoras = status.activity.printers;
  if (impresoras.length === 0) {
    lista.replaceChildren(
      el(
        "li",
        { className: "vacio" },
        status.running
          ? "Este equipo no tiene impresoras asignadas. Dalas de alta en el panel de administración, en Impresoras."
          : "Las impresoras aparecen en cuanto el equipo conecta con la plataforma.",
      ),
    );
    return;
  }
  lista.replaceChildren(
    ...impresoras.map((p) => {
      const e = estadoDeImpresora(p);
      const fila = el(
        "li",
        { className: "impresora", dataset: { estado: e.clave } },
        el("span", { className: "impresora-estado" }, el("span", { className: "punto" }), e.texto),
        el(
          "span",
          { className: "impresora-texto" },
          el("span", { className: "impresora-nombre" }, p.name),
          el(
            "span",
            { className: "impresora-meta" },
            `${capitaliza(nombreDeDestino(p.destination))} · `,
            conexionDe(p),
          ),
        ),
      );
      if (conAcciones) fila.append(accionesDeImpresora(p));
      return fila;
    }),
  );
}

function capitaliza(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function accionesDeImpresora(p: TickPrinter): HTMLElement {
  const previo = resultados.get(p.id);
  const resultado = el(
    "span",
    { className: "resultado", dataset: previo ? { tipo: previo.tipo } : {} },
    previo?.texto ?? "",
  );
  const decir = (tipo: "ok" | "error" | "info", texto: string) => {
    resultados.set(p.id, { tipo, texto });
    resultado.dataset.tipo = tipo;
    resultado.textContent = texto;
  };

  const b =
    p.conexion === "usb"
      ? boton("Imprimir prueba", { icono: "i-impresora" })
      : boton("Comprobar conexión", { icono: "i-red" });
  b.disabled = !agent || (p.conexion === "usb" && status?.platform !== "win32");

  b.addEventListener("click", async () => {
    if (!agent) return;
    if (p.conexion === "usb") {
      await conEspera(b, "Imprimiendo…", async () => {
        try {
          await agent.testPrint(p.printerName ?? "");
          decir("info", "Prueba enviada. ¿Ha salido el ticket?");
        } catch (e) {
          decir("error", `No se pudo imprimir: ${(e as Error).message}`);
        }
      });
      return;
    }
    await conEspera(b, "Comprobando…", async () => {
      try {
        const r = await agent.probeNetworkPrinters();
        if (!r.ok) {
          decir("error", "El equipo aún no ha conectado con la plataforma.");
          return;
        }
        const sonda = r.printers.find((x) => x.id === p.id);
        if (!sonda) decir("error", "El panel ya no la tiene asignada.");
        else if (sonda.ok) decir("ok", "Responde.");
        else decir("error", `No responde (${sonda.reason ?? "sin detalle"}).`);
      } catch (e) {
        decir("error", `No se pudo comprobar: ${(e as Error).message}`);
      }
    });
  });

  return el("span", { className: "impresora-accion" }, resultado, b);
}

async function pintarImpresorasDeWindows(): Promise<void> {
  const lista = $("impresoras-windows");
  if (!agent || status?.platform !== "win32") {
    lista.replaceChildren();
    return;
  }
  const nombres = await agent.listPrinters();
  if (nombres.length === 0) {
    lista.replaceChildren(
      el("li", { className: "vacio" }, "Windows no tiene ninguna impresora instalada."),
    );
    return;
  }
  lista.replaceChildren(
    ...nombres.map((nombre) => {
      const copiar = boton("Copiar nombre", { icono: "i-copiar", clase: "fantasma" });
      copiar.addEventListener("click", async () => {
        if (await agent.copyText(nombre)) {
          copiar.replaceChildren(icono("i-ok"), "Copiado");
          setTimeout(() => copiar.replaceChildren(icono("i-copiar"), "Copiar nombre"), 1600);
        }
      });
      const probar = boton("Imprimir prueba", { icono: "i-impresora" });
      const resultado = el("span", { className: "resultado" });
      probar.addEventListener("click", () =>
        conEspera(probar, "Imprimiendo…", async () => {
          try {
            await agent.testPrint(nombre);
            resultado.dataset.tipo = "info";
            resultado.textContent = "Prueba enviada. ¿Ha salido el ticket?";
          } catch (e) {
            resultado.dataset.tipo = "error";
            resultado.textContent = `No se pudo imprimir: ${(e as Error).message}`;
          }
        }),
      );
      return el(
        "li",
        {},
        el("span", { className: "windows-nombre" }, nombre),
        el("span", { className: "impresora-accion" }, resultado, copiar, probar),
      );
    }),
  );
}

/* --- Vinculación ---------------------------------------------------------------------------- */

const ERROR_AL_VINCULAR: Record<string, string> = {
  "invalid-code":
    "Código no válido o caducado. Genera uno nuevo en el panel, en Dispositivos, y pégalo aquí.",
  "rate-limited": "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.",
  network: "No hay conexión con la plataforma. Revisa la red de este equipo y vuelve a probar.",
};

function pintarVinculacion(): void {
  if (!status) return;
  const ficha = $("ficha-vinculacion");
  const acciones = $("acciones-vinculacion");
  if (!status.paired) {
    ficha.replaceChildren(
      el("dt", {}, "Estado"),
      el("dd", {}, "Este equipo no está vinculado a ningún negocio."),
    );
    acciones.replaceChildren(
      el(
        "button",
        { type: "button", className: "boton primario", dataset: { irA: "estado" } },
        "Vincular",
      ),
    );
    return;
  }
  ficha.replaceChildren(
    el("dt", {}, "Negocio"),
    el("dd", {}, status.activity.businessName ?? "Pendiente de la primera conexión"),
    el("dt", {}, "Equipo"),
    el("dd", { title: status.deviceId ?? "" }, (status.deviceId ?? "").slice(0, 8)),
  );
  const desvincular = boton("Desvincular este equipo", { clase: "peligro" });
  desvincular.addEventListener("click", async () => {
    if (!agent || !(await agent.confirmUnpair())) return;
    await agent.unpair();
    await refrescar();
    void irA("estado");
  });
  acciones.replaceChildren(desvincular);
}

$("vincular").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (!agent) return;
  const campo = $<HTMLInputElement>("codigo");
  const mensaje = $("vincular-mensaje");
  const codigo = campo.value.trim();
  if (!codigo) {
    campo.setAttribute("aria-invalid", "true");
    mensaje.dataset.tipo = "error";
    mensaje.textContent = "Pega primero el código que genera el panel.";
    campo.focus();
    return;
  }
  await conEspera($<HTMLButtonElement>("vincular-boton"), "Vinculando…", async () => {
    try {
      const r = await agent.pair(codigo);
      if (r.ok) {
        campo.value = "";
        campo.removeAttribute("aria-invalid");
        mensaje.textContent = "";
        await refrescar();
        return;
      }
      campo.setAttribute("aria-invalid", "true");
      mensaje.dataset.tipo = "error";
      mensaje.textContent = ERROR_AL_VINCULAR[r.kind] ?? ERROR_AL_VINCULAR.network ?? "";
    } catch (e) {
      // Fallo que no es del código: p. ej. no se pudo guardar la credencial o arrancar el agente.
      mensaje.dataset.tipo = "error";
      mensaje.textContent = `No se pudo completar la vinculación: ${(e as Error).message}`;
    }
  });
});

$("codigo").addEventListener("input", () => {
  $("codigo").removeAttribute("aria-invalid");
  $("vincular-mensaje").textContent = "";
});

/* --- Registro y soporte --------------------------------------------------------------------- */

let filtro: Filtro = "todo";
let entradas: Entrada[] = [];

const NIVEL: Record<Entrada["nivel"], string> = { info: "Info", aviso: "Aviso", error: "Error" };

function pintarRegistro(): void {
  const visibles = filtrar(entradas, filtro);
  const lista = $("registro");
  if (visibles.length === 0) {
    lista.replaceChildren(
      el(
        "li",
        { className: "vacio" },
        entradas.length === 0
          ? "Todavía no hay nada registrado."
          : "Nada que mostrar con este filtro.",
      ),
    );
    return;
  }
  lista.replaceChildren(
    ...visibles.map((e) =>
      el(
        "li",
        { dataset: { nivel: e.nivel } },
        el(
          "span",
          { className: "cuando" },
          e.cuando
            ? e.cuando.toLocaleString("es-ES", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : "",
        ),
        el("span", { className: "nivel" }, NIVEL[e.nivel]),
        el("span", {}, e.mensaje),
        e.detalle.length > 0 ? el("pre", { className: "traza" }, e.detalle.join("\n")) : null,
      ),
    ),
  );
}

async function cargarRegistro(): Promise<void> {
  if (!agent) return;
  entradas = entradasDelRegistro(await agent.readLog());
  pintarRegistro();
}

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-filtro]")) {
  b.addEventListener("click", () => {
    filtro = b.dataset.filtro as Filtro;
    for (const otro of document.querySelectorAll<HTMLButtonElement>("[data-filtro]")) {
      otro.setAttribute("aria-pressed", String(otro === b));
    }
    pintarRegistro();
  });
}

$("refrescar-registro").addEventListener("click", () => void cargarRegistro());
$("refrescar-windows").addEventListener("click", () => void pintarImpresorasDeWindows());

$("exportar").addEventListener("click", async () => {
  if (!agent) return;
  const mensaje = $("exportar-mensaje");
  await conEspera($<HTMLButtonElement>("exportar"), "Exportando…", async () => {
    try {
      const r = await agent.exportDiagnostics();
      if (r.ok) {
        mensaje.dataset.tipo = "ok";
        mensaje.textContent = `Guardado en ${r.path}`;
        $("mostrar-diagnostico").hidden = false;
      } else if (!("canceled" in r)) {
        mensaje.dataset.tipo = "error";
        mensaje.textContent = `No se pudo guardar: ${r.error}`;
      }
    } catch (e) {
      mensaje.dataset.tipo = "error";
      mensaje.textContent = `No se pudo exportar: ${(e as Error).message}`;
    }
  });
});

$("mostrar-diagnostico").addEventListener("click", () => void agent?.showLastDiagnostics());

/* --- Arranque ------------------------------------------------------------------------------- */

async function refrescar(): Promise<void> {
  if (!agent) return;
  status = await agent.getStatus();
  seguirCorteDeRed(status.activity);
  pintar();
}

// La navegación se instala FUERA de la comprobación del puente: cambiar de sección es
// interfaz pura y tiene que funcionar aunque el IPC falle (ver `setupNavigation`).
const { irA } = setupNavigation(document, agent ? (s) => agent.showSection(s) : undefined, (s) => {
  if (s === "ajustes") void cargarRegistro();
});
void irA("estado");
// Al cerrar la ventana se cierra la sesión de gestión: al reabrirla se vuelve a Estado.
agent?.onVolverAlMenu(() => void irA("estado"));

if (!agent) {
  $("pildora").dataset.nivel = "error";
  $("pildora-texto").textContent = "Error";
  $("negocio").textContent = "SuarEx Agente";
  $("estado").dataset.nivel = "error";
  $("estado-icono").setAttribute("href", "#i-error");
  $("estado-titulo").textContent = "La aplicación no ha podido iniciarse";
  $("estado-detalle").textContent =
    "Falta una pieza interna de la aplicación. Ciérrala y vuelve a abrirla; si sigue igual, reinstálala.";
} else {
  // Cada tick del agente llega empujado: el estado se repinta sin sondear.
  agent.onActivity((activity) => {
    if (!status) return;
    status = { ...status, activity };
    seguirCorteDeRed(activity);
    pintar();
  });
  // Y cuando cambia solo (empieza o termina de conectar al arrancar), se vuelve a pedir.
  agent.onEstadoCambiado(() => void refrescar());
  // El margen de un corte de red vence aunque no llegue ningún tick nuevo.
  setInterval(() => {
    if (sinConexionDesde !== null) pintar();
  }, 5000);

  void refrescar().then(() => pintarImpresorasDeWindows());
}
