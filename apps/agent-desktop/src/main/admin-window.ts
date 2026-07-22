import { BrowserWindow, shell } from "electron";
import { PLATFORM_WEB_ORIGIN } from "./baked-config.js";

/**
 * Ventana de GESTIÓN: carga el panel web de la plataforma (`/admin/catalogo`) dentro de la
 * app de escritorio, para que el dueño pueda editar su carta sin salir a un navegador.
 *
 * No reimplementa nada. El panel web ya tiene las validaciones, las Server Actions y las
 * comprobaciones de rol; duplicarlas aquí en una interfaz nativa crearía dos juegos de
 * reglas que divergirían con el primer cambio.
 *
 * ---
 *
 * SEGURIDAD. Esta ventana carga contenido REMOTO, así que se trata como hostil:
 *
 * 1. **Sin `preload`.** La ventana principal expone `window.agent.*` (emparejar, imprimir,
 *    des-emparejar) por contextBridge. Si esta ventana lo heredara, una página comprometida
 *    -- o un XSS en el panel -- podría des-emparejar el dispositivo o disparar impresiones.
 *    El panel web no necesita nada de eso: habla con su servidor por HTTP y punto.
 * 2. **`sandbox: true`** además de `contextIsolation` y `nodeIntegration: false`.
 * 3. **Partición de sesión propia y persistente.** `persist:admin` mantiene la sesión
 *    iniciada entre arranques (nadie quiere teclear la contraseña cada vez) pero con un
 *    tarro de cookies separado del resto de la app.
 * 4. **La navegación no puede salir del origen de la plataforma.** Sin esto, un enlace
 *    externo convertiría esta ventana en un navegador completo sin barra de direcciones ni
 *    indicador de sitio: el usuario no podría saber qué está mirando, que es justo la
 *    condición que necesita una página de phishing. Fuera de origen se abre en el navegador
 *    del sistema, donde sí hay barra de direcciones.
 *
 * El identificador del dispositivo NO interviene: los permisos vienen de la persona que
 * inicia sesión (rol owner/admin), no de la máquina. Las credenciales del dispositivo
 * siguen siendo de solo-imprimir, y RLS excluye al rol `device` del catálogo
 * (`20260722000005_device_rls_hardening.sql`). Así, robar este PC no permite reescribir
 * los precios del negocio.
 */

let adminWindow: BrowserWindow | null = null;

/**
 * ¿Esta URL pertenece al origen de la plataforma?
 *
 * Compara el ORIGEN completo (esquema + host + puerto), nunca por prefijo de cadena: un
 * `startsWith` dejaría pasar `https://suarex.app.atacante.com` y también degradaría de
 * https a http sin avisar. Una URL malformada se rechaza en vez de lanzar.
 *
 * Función pura y exportada para poder probarla: es la guarda de seguridad de la ventana.
 */
export function isSameOrigin(url: string, origin: string): boolean {
  if (!origin) return false;
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export type OpenAdminResult = { ok: true } | { ok: false; reason: "sin-origen-configurado" };

/** Abre (o enfoca, si ya está abierta) la ventana de gestión. */
export function openAdminWindow(): OpenAdminResult {
  // Sin origen horneado no hay a dónde ir. Se falla explícito en vez de abrir una ventana
  // en blanco que el usuario interpretaría como un error de la plataforma.
  if (!PLATFORM_WEB_ORIGIN) return { ok: false, reason: "sin-origen-configurado" };

  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.show();
    adminWindow.focus();
    return { ok: true };
  }

  adminWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "SuarEx — Gestión",
    webPreferences: {
      // Sin preload a propósito: ver el punto 1 del docstring de arriba.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: "persist:admin",
    },
  });

  // `window.open` y `target="_blank"` van al navegador del sistema, nunca a una ventana
  // hija de Electron (que heredaría las preferencias de esta y perdería la guarda de
  // navegación de abajo).
  adminWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, PLATFORM_WEB_ORIGIN)) {
      adminWindow?.loadURL(url);
    } else {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  adminWindow.webContents.on("will-navigate", (event, url) => {
    if (isSameOrigin(url, PLATFORM_WEB_ORIGIN)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  adminWindow.on("closed", () => {
    adminWindow = null;
  });

  adminWindow.loadURL(`${PLATFORM_WEB_ORIGIN}/admin/catalogo`);
  return { ok: true };
}

/** Cierra la ventana de gestión si está abierta (lo llama el cierre de la app). */
export function closeAdminWindow(): void {
  if (adminWindow && !adminWindow.isDestroyed()) adminWindow.close();
  adminWindow = null;
}
