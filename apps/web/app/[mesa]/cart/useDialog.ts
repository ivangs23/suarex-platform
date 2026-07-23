"use client";

import { type RefObject, useEffect } from "react";

/**
 * Comportamiento común de un diálogo modal: cerrar con Escape, mover el foco DENTRO al abrir,
 * atraparlo mientras está abierto y devolverlo a donde estaba al cerrar.
 *
 * Por qué el trap: sin él, tabulando desde el diálogo el foco se escapa a la carta de detrás
 * -- que sigue ahí, tapada por el overlay pero enfocable -- y quien navega con teclado o
 * lector de pantalla acaba "escribiendo" en una pantalla que no ve. Un diálogo `aria-modal`
 * promete justo lo contrario: mientras esté abierto, el resto no existe.
 *
 * Se comparte entre la ficha del producto y el panel del pedido (y el pago vive dentro de
 * este) para no reimplementar -- y olvidar una pieza en -- cada uno.
 */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  // Cambia esta clave cuando el CONTENIDO del diálogo se sustituye entero sin desmontar el
  // contenedor (p. ej. el panel del pedido pasa a ser el formulario de pago). Sin ella, el
  // trap seguiría anclado al nodo anterior, ya desmontado, y el foco se escaparía.
  resetKey?: unknown,
) {
  // `resetKey` no se usa en el cuerpo del efecto a propósito: está en las deps SOLO para
  // re-ejecutarlo (re-anclar el trap al nuevo nodo) cuando el contenido del diálogo se
  // sustituye. Es un disparador deliberado, no una dependencia olvidada.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey es un disparador de re-ejecución intencionado, ver arriba
  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;

    // A dónde devolver el foco al cerrar: el elemento que tenía el foco al abrir (el botón que
    // abrió el diálogo). Sin esto, cerrar deja el foco "en ninguna parte" y el teclado vuelve
    // al principio de la página.
    const previo = document.activeElement as HTMLElement | null;

    const enfocables = () =>
      Array.from(
        nodo.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    // Foco inicial dentro del diálogo: el primer control, o el propio contenedor.
    (enfocables()[0] ?? nodo).focus();

    const onKeyDown = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        onClose();
        return;
      }
      if (evento.key !== "Tab") return;

      // Trap: al llegar al borde, se salta al otro extremo en vez de salir del diálogo.
      const items = enfocables();
      if (items.length === 0) {
        evento.preventDefault();
        return;
      }
      const primero = items[0];
      const ultimo = items[items.length - 1];
      const activo = document.activeElement;

      if (evento.shiftKey && activo === primero) {
        evento.preventDefault();
        ultimo?.focus();
      } else if (!evento.shiftKey && activo === ultimo) {
        evento.preventDefault();
        primero?.focus();
      }
    };

    nodo.addEventListener("keydown", onKeyDown);
    return () => {
      nodo.removeEventListener("keydown", onKeyDown);
      // Devuelve el foco solo si sigue vivo en el DOM (no lo desmontó otra cosa).
      if (previo?.isConnected) previo.focus();
    };
  }, [ref, onClose, resetKey]);
}
