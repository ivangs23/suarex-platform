import { type BrowserWindow, shell, WebContentsView } from "electron";
import { PLATFORM_WEB_ORIGIN } from "./baked-config.js";

/**
 * Panel incrustado con las páginas de la plataforma (catálogo, pedidos), colocado a la
 * derecha de la barra lateral dentro de la ventana principal.
 *
 * No reimplementa esas pantallas. El panel web ya tiene sus validaciones, sus Server
 * Actions y sus comprobaciones de rol; duplicarlas en una interfaz nativa crearía dos
 * juegos de reglas que divergirían con el primer cambio.
 *
 * Se usa `WebContentsView` y no la etiqueta `<webview>`: esa última está desaconsejada por
 * Electron, y además reutilizaría el proceso del renderer -- que SÍ tiene el puente
 * `window.agent`. Una vista aparte mantiene el contenido remoto en su propio `webContents`,
 * que es lo que permite las garantías de abajo.
 *
 * ---
 *
 * SEGURIDAD. Carga contenido REMOTO, así que se trata como hostil:
 *
 * 1. **Sin `preload`.** El renderer principal expone `window.agent.*` (emparejar, imprimir,
 *    des-emparejar) por contextBridge. Si esta vista lo heredara, un XSS en el panel podría
 *    des-emparejar el dispositivo o disparar impresiones. No necesita nada de eso: habla
 *    con su servidor por HTTP.
 * 2. **`sandbox: true`**, además de `contextIsolation` y `nodeIntegration: false`.
 * 3. **Partición propia y persistente** (`persist:admin`): mantiene la sesión iniciada
 *    entre arranques con un tarro de cookies separado del resto de la app.
 * 4. **La navegación no sale del origen de la plataforma.** Sin esa guarda, un enlace
 *    externo convertiría este panel en un navegador SIN barra de direcciones: el usuario no
 *    podría saber qué sitio mira mientras teclea su contraseña, que es justo la condición
 *    que necesita una página de phishing. Fuera de origen se abre en el navegador del
 *    sistema, donde sí hay barra de direcciones.
 *
 * Los permisos vienen de la PERSONA que inicia sesión (owner/admin), no de la máquina: las
 * credenciales del dispositivo siguen siendo de solo-imprimir y RLS excluye al rol `device`
 * del catálogo. Robar este PC no permite reescribir los precios del negocio.
 */

/** Ancho de la barra lateral, en píxeles CSS. Debe coincidir con `--sidebar` en styles.css:
 * el renderer pinta la barra y esta vista se coloca justo a su derecha. */
export const SIDEBAR_WIDTH = 208;

/** Secciones de la plataforma que se pueden incrustar, y su ruta. */
export const WEB_SECTIONS = {
  productos: "/admin/catalogo",
  pedidos: "/staff",
} as const;

export type WebSection = keyof typeof WEB_SECTIONS;

export function isWebSection(value: string): value is WebSection {
  return value in WEB_SECTIONS;
}

/**
 * ¿Esta URL pertenece al origen de la plataforma?
 *
 * Compara el ORIGEN completo (esquema + host + puerto), nunca por prefijo de cadena: un
 * `startsWith` dejaría pasar `https://suarex.app.atacante.com` y también degradaría de
 * https a http sin avisar. Una URL malformada se rechaza en vez de lanzar.
 *
 * Función pura y exportada para poder probarla: es la guarda de seguridad del panel.
 */
export function isSameOrigin(url: string, origin: string): boolean {
  if (!origin) return false;
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

let view: WebContentsView | null = null;
let currentSection: WebSection | null = null;

export type ShowWebPanelResult = { ok: true } | { ok: false; reason: "sin-origen-configurado" };

function ensureView(window: BrowserWindow): WebContentsView {
  if (view) return view;

  view = new WebContentsView({
    webPreferences: {
      // Sin preload a propósito: ver el punto 1 del docstring de arriba.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:admin",
    },
  });

  // `window.open` y `target="_blank"` van al navegador del sistema, nunca a una ventana
  // hija de Electron (que heredaría estas preferencias y perdería la guarda de navegación).
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, PLATFORM_WEB_ORIGIN)) view?.webContents.loadURL(url);
    else shell.openExternal(url);
    return { action: "deny" };
  });

  view.webContents.on("will-navigate", (event, url) => {
    if (isSameOrigin(url, PLATFORM_WEB_ORIGIN)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  window.contentView.addChildView(view);
  return view;
}

/** Coloca la vista a la derecha de la barra lateral, ocupando el resto de la ventana. */
export function layoutWebPanel(window: BrowserWindow): void {
  if (!view || currentSection === null) return;
  const { width, height } = window.getContentBounds();
  view.setBounds({
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, width - SIDEBAR_WIDTH),
    height,
  });
}

/** Muestra una sección de la plataforma. Recarga solo si cambia de sección. */
export function showWebPanel(window: BrowserWindow, section: WebSection): ShowWebPanelResult {
  // Sin origen horneado no hay a dónde ir. Se falla explícito en vez de dejar un panel en
  // blanco que el usuario interpretaría como un error de la plataforma.
  if (!PLATFORM_WEB_ORIGIN) return { ok: false, reason: "sin-origen-configurado" };

  const v = ensureView(window);
  v.setVisible(true);

  if (currentSection !== section) {
    currentSection = section;
    v.webContents.loadURL(`${PLATFORM_WEB_ORIGIN}${WEB_SECTIONS[section]}`);
  }

  layoutWebPanel(window);
  return { ok: true };
}

/**
 * Oculta el panel al pasar a una sección local.
 *
 * Se OCULTA, no se destruye: la vista se superpone al renderer, así que dejarla visible
 * taparía la sección local. Conservarla mantiene la sesión y el estado de la página, de
 * modo que volver a Productos no obliga a recargar ni a iniciar sesión otra vez.
 */
export function hideWebPanel(): void {
  view?.setVisible(false);
}

/** Libera la vista al cerrar la app. */
export function destroyWebPanel(): void {
  if (view) view.webContents.close();
  view = null;
  currentSection = null;
}
