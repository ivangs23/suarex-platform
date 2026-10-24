import { type BrowserWindow, session, shell, WebContentsView } from "electron";
import { PLATFORM_WEB_ORIGIN } from "./baked-config.js";

/**
 * Panel incrustado con las páginas de la plataforma. Es contenido REMOTO y se trata como hostil:
 * `WebContentsView` sin `preload`, con `sandbox`, dos sesiones y navegación solo al origen de la
 * plataforma. Ver docs/decisions/0008-panel-web-aislado-en-el-agente.md.
 */

/** Alto de la cabecera, en píxeles CSS. Debe coincidir con `--topbar` en styles.css: el renderer
 * pinta la cabecera y esta vista se coloca justo debajo, ocupando TODO el ancho.
 *
 * Antes esto era el ancho de una barra lateral. Se cambió a una cabecera porque en un PC de
 * mostrador 208 px de barra siempre visible eran 208 px menos de comandas, y porque el estado de
 * las impresoras se lee mejor encima de lo que estás mirando que en un lateral. */
export const HEADER_HEIGHT = 56;

/** Secciones de la plataforma que se pueden incrustar, y su ruta. */
export const WEB_SECTIONS = {
  productos: "/admin/catalogo",
  pedidos: "/staff",
  cierre: "/admin/cierre",
} as const;

export type WebSection = keyof typeof WEB_SECTIONS;

export function isWebSection(value: string): value is WebSection {
  return value in WEB_SECTIONS;
}

/** Cada sesión del panel. Ver el punto 3 del docstring de arriba. */
export type Panel = "comandas" | "gestion";

/**
 * Partición de cada panel. `persist:` delante es lo que hace que Chromium la guarde en disco:
 * la de gestión no lo lleva, y con eso su sesión no sobrevive a cerrar la app.
 */
export const PARTICIONES: Record<Panel, string> = {
  comandas: "persist:comandas",
  gestion: "gestion",
};

/**
 * Donde vivía la sesión cuando el panel tenía una sola. Puede guardar en disco una sesión de
 * owner (con la que se cambian precios) que ya no usa nadie, así que se vacía al arrancar.
 */
export const PARTICION_ANTIGUA = "persist:admin";

/** Qué sesión usa cada sección: las Comandas, la suya; lo que gestiona el negocio, la otra. */
export function panelDe(section: WebSection): Panel {
  return section === "pedidos" ? "comandas" : "gestion";
}

/**
 * ¿Esta URL pertenece al origen de la plataforma? Compara el ORIGEN completo (esquema, host y
 * puerto), nunca por prefijo: un `startsWith` dejaría pasar `https://suarex.app.atacante.com`.
 * Una URL malformada se rechaza. Es la guarda de seguridad del panel (ADR 0008).
 */
export function isSameOrigin(url: string, origin: string): boolean {
  if (!origin) return false;
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Cuándo merece la pena registrar un fallo de carga. `ERR_ABORTED` (-3) llega en cada
 * navegación que se cancela sola (redirección, `router.push`): es lo NORMAL, y registrarlo
 * llenaría el log de rojo hasta que nadie lo mirara. `0` es "sin error".
 */
export function esFalloDeCargaRelevante(errorCode: number): boolean {
  return errorCode !== 0 && errorCode !== -3;
}

/**
 * La línea de registro de un mensaje de la consola del panel, o `null` si no merece una: solo
 * los errores; el resto es ruido de desarrollo del propio Next. Los datos vienen en el evento
 * (los argumentos sueltos están obsoletos desde Electron 35, y ahí `level` era un número).
 */
export function lineaDeConsola(evento: {
  level: string;
  message: string;
  lineNumber: number;
  sourceId: string;
}): string | null {
  if (evento.level !== "error") return null;
  return `Panel: error en la página — ${evento.message} (${evento.sourceId}:${evento.lineNumber})`;
}

/** A dónde van los sucesos del panel. Lo inyecta `index.ts` con el logger a fichero. */
export type PanelReporter = (mensaje: string) => void;
let reportar: PanelReporter = () => {};
export function setWebPanelReporter(fn: PanelReporter): void {
  reportar = fn;
}

/** Una vista por sesión: la partición se fija al crear la vista y no se puede cambiar después. */
type Vista = { view: WebContentsView; section: WebSection | null };
const vistas: Partial<Record<Panel, Vista>> = {};

export type ShowWebPanelResult = { ok: true } | { ok: false; reason: "sin-origen-configurado" };

function ensureView(window: BrowserWindow, panel: Panel): Vista {
  const existente = vistas[panel];
  if (existente) return existente;

  const view = new WebContentsView({
    webPreferences: {
      // Sin preload a propósito: ver el punto 1 del docstring de arriba.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: PARTICIONES[panel],
    },
  });

  // `window.open` y `target="_blank"` van al navegador del sistema, nunca a una ventana
  // hija de Electron (que heredaría estas preferencias y perdería la guarda de navegación).
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, PLATFORM_WEB_ORIGIN)) view.webContents.loadURL(url);
    else shell.openExternal(url);
    return { action: "deny" };
  });

  view.webContents.on("will-navigate", (event, url) => {
    if (isSameOrigin(url, PLATFORM_WEB_ORIGIN)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  /* Lo que pase aquí dentro va al registro de la máquina.
   *
   * Sin esto el panel es una caja negra: si la página no carga o su JavaScript revienta, lo
   * único que ve el usuario es un recuadro en blanco o un error genérico, y desde fuera no hay
   * NADA que mirar. Este es justo el equipo que está a 300 km, así que el rastro tiene que
   * quedar en su disco, que es lo que luego se exporta con "Exportar diagnóstico". */
  view.webContents.on("did-fail-load", (_e, errorCode, errorDescription, url) => {
    if (!esFalloDeCargaRelevante(errorCode)) return;
    reportar(`Panel: no se pudo cargar ${url} (${errorDescription}, ${errorCode})`);
  });

  view.webContents.on("console-message", (evento) => {
    const linea = lineaDeConsola(evento);
    if (linea) reportar(linea);
  });

  view.webContents.on("render-process-gone", (_e, details) => {
    reportar(`Panel: la vista se cayó (${details.reason}).`);
  });

  window.contentView.addChildView(view);
  const vista: Vista = { view, section: null };
  vistas[panel] = vista;
  return vista;
}

/** Coloca las vistas justo debajo de la cabecera, ocupando el resto de la ventana. */
export function layoutWebPanel(window: BrowserWindow): void {
  const { width, height } = window.getContentBounds();
  for (const vista of Object.values(vistas)) {
    if (vista.section === null) continue;
    vista.view.setBounds({
      x: 0,
      y: HEADER_HEIGHT,
      width,
      height: Math.max(0, height - HEADER_HEIGHT),
    });
  }
}

/** Muestra una sección de la plataforma en la vista de su sesión. Recarga solo si cambia. */
export function showWebPanel(window: BrowserWindow, section: WebSection): ShowWebPanelResult {
  // Sin origen horneado no hay a dónde ir. Se falla explícito en vez de dejar un panel en
  // blanco que el usuario interpretaría como un error de la plataforma.
  if (!PLATFORM_WEB_ORIGIN) return { ok: false, reason: "sin-origen-configurado" };

  const panel = panelDe(section);
  // La otra sesión se aparta: las dos vistas ocupan el mismo sitio.
  for (const [otro, vista] of Object.entries(vistas)) {
    if (otro !== panel) vista.view.setVisible(false);
  }

  const vista = ensureView(window, panel);
  vista.view.setVisible(true);
  if (vista.section !== section) {
    vista.section = section;
    vista.view.webContents.loadURL(`${PLATFORM_WEB_ORIGIN}${WEB_SECTIONS[section]}`);
  }

  layoutWebPanel(window);
  return { ok: true };
}

/**
 * Oculta el panel al pasar a una sección local.
 *
 * Se OCULTA, no se destruye: la vista se superpone al renderer, así que dejarla visible
 * taparía la sección local. Conservarla mantiene la sesión y el estado de la página, de
 * modo que volver a Comandas no obliga a recargar ni a iniciar sesión otra vez.
 */
export function hideWebPanel(): void {
  for (const vista of Object.values(vistas)) vista.view.setVisible(false);
}

/**
 * Cierra la sesión de gestión. Se llama al cerrar la ventana: desde ese momento, quien abra el
 * agente tiene que volver a identificarse para tocar precios o cerrar caja, aunque el proceso
 * lleve días vivo en la bandeja. La página se descarga además de borrar la sesión: si no, al
 * reabrir seguiría a la vista el catálogo que quedó cargado.
 */
export async function olvidarSesionDeGestion(): Promise<void> {
  await olvidar("gestion");
}

/**
 * Cierra TODAS las sesiones del panel, también la de Comandas, que se guarda en disco. Se llama al
 * des-emparejar: ese PC deja de pertenecer al restaurante, y quien lo herede no puede encontrarse
 * dentro del panel con la cuenta de quien lo usaba, hasta 400 días después.
 */
export async function olvidarTodasLasSesiones(): Promise<void> {
  for (const panel of Object.keys(PARTICIONES) as Panel[]) await olvidar(panel);
}

/** Descarga la vista (si no, seguiría a la vista lo que quedó cargado) y borra su sesión. */
async function olvidar(panel: Panel): Promise<void> {
  const vista = vistas[panel];
  if (vista) {
    vista.section = null;
    vista.view.setVisible(false);
    vista.view.webContents.loadURL("about:blank");
  }
  await session.fromPartition(PARTICIONES[panel]).clearStorageData();
}

/** Vacía la partición de cuando había una sola sesión (ver `PARTICION_ANTIGUA`). */
export async function vaciarParticionAntigua(): Promise<void> {
  await session.fromPartition(PARTICION_ANTIGUA).clearStorageData();
}

/** Libera las vistas al cerrar la app. */
export function destroyWebPanel(): void {
  for (const panel of Object.keys(vistas) as Panel[]) {
    vistas[panel]?.view.webContents.close();
    delete vistas[panel];
  }
}
