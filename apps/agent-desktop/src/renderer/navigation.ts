/** Resultado de pedirle al proceso principal que muestre una sección. */
export type ShowSection = (section: string) => Promise<{ ok: boolean }>;

/**
 * Navegación por pestañas de la cabecera.
 *
 * Vive en su propio módulo, y no suelta dentro de `main.ts`, porque es la única parte de la
 * interfaz con lógica de verdad (qué se ve, qué se marca, a quién se avisa) y `main.ts` es un
 * guion con efectos al importarse, imposible de probar sin arrancar la app.
 *
 * `showSection` es OPCIONAL a propósito: cambiar de sección es interfaz pura y tiene que
 * funcionar aunque el puente IPC no esté disponible. Tenerlo acoplado dejó una vez la
 * navegación entera muerta cuando falló el preload, justo cuando más falta hace moverse por la
 * app para leer el error.
 *
 * Además de las pestañas, cualquier botón con `data-ir-a="<sección>"` lleva a ella (la acción
 * de una alerta, la píldora de estado). Se escucha por delegación: esos botones se crean después.
 */
export function setupNavigation(
  root: Document | HTMLElement,
  showSection?: ShowSection,
  alEntrar?: (section: string) => void,
) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".tab")];
  const panels = [...root.querySelectorAll<HTMLElement>(".panel")];

  async function irA(section: string): Promise<void> {
    for (const tab of tabs) {
      if (tab.dataset.section === section) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== section;
    }
    alEntrar?.(section);

    if (!showSection) return;

    // SIEMPRE se avisa, también en las secciones locales: la vista incrustada de la plataforma
    // se SUPERPONE a esta zona y, sin el aviso, seguiría tapando Estado o Ajustes.
    const r = await showSection(section);
    if (r.ok) return;

    // La sección web no puede cargarse: se dice en su propio panel, que queda a la vista
    // justamente porque la vista incrustada no llegó a superponerse.
    const destino = root.querySelector<HTMLElement>(`#web-fallback-${section}`);
    if (destino) {
      destino.textContent =
        "Esta sección no está disponible en esta instalación: el instalador se generó sin la " +
        "dirección de la plataforma (PLATFORM_WEB_ORIGIN). Avisa a SuarEx para que lo rehaga.";
    }
  }

  root.addEventListener("click", (evento) => {
    const destino = (evento.target as Element | null)?.closest<HTMLElement>(
      ".tab[data-section], [data-ir-a]",
    );
    if (!destino) return;
    const section = destino.dataset.section ?? destino.dataset.irA;
    if (section) void irA(section);
  });

  return { irA };
}
