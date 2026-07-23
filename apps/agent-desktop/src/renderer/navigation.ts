/** Resultado de pedirle al proceso principal que muestre una sección. */
export type ShowSection = (section: string) => Promise<{ ok: boolean }>;

/**
 * Navegación de la barra lateral.
 *
 * Vive en su propio módulo, y no suelta dentro de `main.ts`, por dos motivos: es la única
 * parte de la interfaz con lógica de verdad (qué se ve, qué se marca, a quién se avisa), y
 * `main.ts` es un guion con efectos al importarse -- imposible de probar sin arrancar la
 * app entera.
 *
 * `showSection` es OPCIONAL a propósito. Cambiar de sección es interfaz pura y tiene que
 * funcionar aunque el puente IPC no esté disponible: tenerlo acoplado dejó una vez la barra
 * lateral entera muerta cuando falló el preload, que es justo cuando más falta hace poder
 * moverse por la app para leer el mensaje de error.
 */
export function setupNavigation(root: ParentNode, showSection?: ShowSection) {
  const navItems = [...root.querySelectorAll<HTMLButtonElement>(".nav-item")];
  const panels = [...root.querySelectorAll<HTMLElement>(".panel")];

  async function irA(section: string): Promise<void> {
    for (const boton of navItems) {
      boton.setAttribute("aria-selected", String(boton.dataset.section === section));
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== section;
    }

    if (!showSection) return;

    // SIEMPRE se avisa, también para las secciones locales: la vista incrustada de la
    // plataforma se SUPERPONE a esta zona, así que sin ese aviso seguiría tapando
    // Configuración e Impresoras al volver de Productos.
    const r = await showSection(section);
    if (r.ok) return;

    // La sección web no puede cargarse: se dice en su propio panel, que queda a la vista
    // justamente porque la vista incrustada no llegó a superponerse.
    const destino = root.querySelector<HTMLElement>(`#web-fallback-${section}`);
    if (destino) {
      destino.textContent =
        "Este instalador se generó sin PLATFORM_WEB_ORIGIN, así que no sabe a qué " +
        "plataforma conectarse. Hay que reconstruirlo con esa variable.";
    }
  }

  for (const boton of navItems) {
    boton.addEventListener("click", () => void irA(boton.dataset.section as string));
  }

  return { irA };
}
