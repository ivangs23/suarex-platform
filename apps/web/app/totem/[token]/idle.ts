/**
 * INACTIVIDAD DEL TOTEM, como lógica pura.
 *
 * Un totem no se cierra nunca: el navegador sigue abierto entre un cliente y el siguiente. Sin
 * esto, quien empieza un pedido y se va deja su carrito puesto, y el siguiente se encuentra la
 * comida de otro en la pantalla -- o peor, la paga.
 *
 * Se resuelve en dos tiempos para no borrarle el pedido a quien solo se ha parado a pensar: tras
 * `idleMs` sin tocar se AVISA ("¿sigues ahí?"), y solo si sigue sin haber actividad durante
 * `graceMs` más se reinicia. Cualquier toque vuelve a empezar la cuenta.
 *
 * Aquí no hay temporizadores ni React a propósito: es una función del tiempo transcurrido, así que
 * se puede probar sin relojes falsos ni renderizar nada.
 */

export type IdlePhase = "active" | "warning" | "expired";

/** En qué fase está el totem según lo que lleve sin que nadie lo toque. */
export function idlePhase(msSinceActivity: number, idleMs: number, graceMs: number): IdlePhase {
  if (msSinceActivity >= idleMs + graceMs) return "expired";
  if (msSinceActivity >= idleMs) return "warning";
  return "active";
}

/** Segundos que quedan antes de reiniciar, para la cuenta atrás del aviso. Nunca negativo. */
export function graceSecondsLeft(msSinceActivity: number, idleMs: number, graceMs: number): number {
  return Math.max(0, Math.ceil((idleMs + graceMs - msSinceActivity) / 1000));
}
