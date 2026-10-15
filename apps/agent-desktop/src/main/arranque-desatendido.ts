/**
 * Arranques DESATENDIDOS: los que lanza Windows sin que nadie haya pulsado nada -- el inicio de
 * sesión y el watchdog del sistema. Llevan este flag para que la app se quede en la bandeja en vez
 * de abrir su ventana encima de lo que haya en pantalla (la carta de un totem, el TPV de cocina).
 *
 * Hace falta un flag propio porque lo que Electron ofrece para esto es solo de macOS:
 * `openAsHidden` y `wasOpenedAtLogin` no existen en Windows, y con ellos la ventana se abría en
 * cada arranque.
 */
export const FLAG_SEGUNDO_PLANO = "--en-segundo-plano";

/** ¿Este arranque (o esta segunda instancia) lo lanzó Windows y no una persona? Puro y testeable. */
export function esArranqueDesatendido(argv: readonly string[]): boolean {
  return argv.includes(FLAG_SEGUNDO_PLANO);
}

/** Opciones de `app.setLoginItemSettings`: arrancar con Windows, en segundo plano. */
export function opcionesDeInicioConWindows(): { openAtLogin: true; args: string[] } {
  return { openAtLogin: true, args: [FLAG_SEGUNDO_PLANO] };
}
