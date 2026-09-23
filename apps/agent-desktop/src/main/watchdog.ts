/**
 * WATCHDOG DEL SISTEMA (solo Windows).
 *
 * Lo que YA estaba cubierto y no repite esto:
 *   - `app.setLoginItemSettings({ openAtLogin: true })` arranca la app al iniciar sesión, así
 *     que un reinicio del PC ya se recupera.
 *   - `render-process-gone` recarga la ventana si se cae el renderer.
 *   - Los manejadores de `uncaughtException`/`unhandledRejection` evitan que una excepción
 *     tumbe el proceso.
 *
 * EL HUECO: que el PROCESO muera. Un cierre forzado desde el administrador de tareas, un OOM,
 * un `taskkill` de un antivirus, o alguien que pulsa "Salir" sin querer. Ahí no queda nadie
 * dentro para recuperarse, y la cocina deja de recibir comandas sin que nada lo diga —
 * exactamente el silencio que la Fase 2 intenta eliminar.
 *
 * LA SOLUCIÓN: una tarea programada de Windows que lanza la app cada `INTERVALO_MINUTOS`. No
 * comprueba si está viva: lanza siempre, y si ya lo está, la SEGUNDA INSTANCIA SALE SOLA por
 * el `requestSingleInstanceLock()` de `index.ts`. Eso evita tener que consultar el estado del
 * proceso desde fuera —que en Windows es frágil— y apoya la recuperación en una garantía que
 * el propio código ya da.
 *
 * Se registra en el contexto del USUARIO, no como servicio: el agente necesita una sesión
 * interactiva para hablar con la cola de impresión (winspool imprime como el usuario) y para
 * mostrar la bandeja. Un servicio de sistema no tendría ni lo uno ni lo otro.
 *
 * ESTE FICHERO NO IMPORTA `electron` A PROPÓSITO: recibe lo que necesita por parámetro, igual
 * que `usb-sink-winspool` recibe su binding. Así la construcción de los comandos se prueba
 * headless, que es la única verificación posible sin un Windows delante (ver
 * `docs/agent-desktop-validacion.md` para la prueba real en el PC de un cliente).
 */

/** Cada cuánto comprueba Windows que el agente sigue vivo. Cinco minutos es el mismo orden que
 *  el barrido de dispositivos caídos del servidor (10 min): así, en el peor caso, el agente se
 *  recupera ANTES de que salte el aviso a soporte, y una caída breve no genera ruido. */
export const INTERVALO_MINUTOS = 5;

export const NOMBRE_TAREA = "SuarEx Agente Watchdog";

export type Ejecutor = (comando: string, args: string[]) => Promise<{ code: number }>;

/**
 * Ejecutor real, con `node:child_process`. Vive aquí y no en el módulo de arriba para que la
 * construcción de los comandos siga probándose sin tocar el sistema: los tests inyectan su
 * propio ejecutor.
 *
 * `execFile` y no `exec`: sin shell de por medio, la ruta del ejecutable no puede
 * interpretarse como comando por mucho que lleve espacios o caracteres raros.
 */
export function ejecutorDelSistema(): Ejecutor {
  return (comando, args) =>
    new Promise((resolve) => {
      import("node:child_process")
        .then(({ execFile }) => {
          execFile(comando, args, (error) => resolve({ code: error ? 1 : 0 }));
        })
        .catch(() => resolve({ code: 1 }));
    });
}

/**
 * Argumentos de `schtasks` para crear (o reemplazar) la tarea.
 *
 * - `/sc minute /mo N`: cada N minutos, indefinidamente.
 * - `/f`: reemplaza si ya existe, para que reinstalar o actualizar no acumule tareas ni falle.
 * - `/rl limited`: SIN privilegios elevados. El agente no los necesita, y pedirlos haría que
 *   la tarea fallara en silencio en un PC donde el usuario no es administrador — que es el
 *   caso normal en un restaurante.
 * - `/it`: solo con el usuario conectado. Es deliberado: sin sesión interactiva no hay cola de
 *   impresión accesible ni bandeja, así que arrancarlo ahí no serviría de nada.
 */
export function argsCrearTarea(rutaEjecutable: string): string[] {
  return [
    "/create",
    "/tn",
    NOMBRE_TAREA,
    "/tr",
    // Las comillas son necesarias: la ruta real lleva espacios ("C:\Program Files\...").
    `"${rutaEjecutable}"`,
    "/sc",
    "minute",
    "/mo",
    String(INTERVALO_MINUTOS),
    "/rl",
    "limited",
    "/it",
    "/f",
  ];
}

export function argsBorrarTarea(): string[] {
  return ["/delete", "/tn", NOMBRE_TAREA, "/f"];
}

/**
 * Registra el watchdog. Idempotente por el `/f` de arriba: llamarlo en cada arranque deja
 * siempre una única tarea, apuntando al ejecutable actual (importante tras una actualización,
 * que puede cambiar la ruta).
 *
 * NUNCA LANZA. Un fallo aquí —política de grupo que prohíbe tareas, `schtasks` ausente— no
 * puede impedir que el agente imprima: perder la recuperación automática es malo, no imprimir
 * es peor. Devuelve si lo consiguió para que quien llama pueda registrarlo.
 */
export async function registrarWatchdog(
  plataforma: string,
  rutaEjecutable: string,
  ejecutar: Ejecutor,
): Promise<boolean> {
  if (plataforma !== "win32") return false;
  try {
    const { code } = await ejecutar("schtasks", argsCrearTarea(rutaEjecutable));
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Quita el watchdog. Se llama al DES-EMPAREJAR: un PC que ya no es de ningún restaurante no
 * debe seguir relanzando una app que no va a hacer nada. Sin esto quedaría una tarea huérfana
 * reabriendo la app cada cinco minutos para siempre.
 */
export async function quitarWatchdog(plataforma: string, ejecutar: Ejecutor): Promise<boolean> {
  if (plataforma !== "win32") return false;
  try {
    const { code } = await ejecutar("schtasks", argsBorrarTarea());
    return code === 0;
  } catch {
    return false;
  }
}
