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
/** Cómo se llama cada sección en la cabecera. La pantalla de inicio lleva la marca, no un título. */
const TITULOS: Record<string, string> = {
  menu: "SuarEx",
  config: "Configuración",
  impresoras: "Impresoras",
  productos: "Productos",
  pedidos: "Comandas",
  cierre: "Cierre de caja",
  logs: "Registro",
};

export function setupNavigation(root: ParentNode, showSection?: ShowSection) {
  const navItems = [...root.querySelectorAll<HTMLButtonElement>(".nav-item")];
  const panels = [...root.querySelectorAll<HTMLElement>(".panel")];
  const topbar = root.querySelector<HTMLElement>(".topbar");
  const back = root.querySelector<HTMLButtonElement>("#back");
  const title = root.querySelector<HTMLElement>("#topbar-title");

  async function irA(section: string): Promise<void> {
    for (const boton of navItems) {
      boton.setAttribute("aria-selected", String(boton.dataset.section === section));
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== section;
    }

    /* En el inicio no hay a dónde volver, así que el botón no está -- uno que no hace nada es
       peor que ninguno. El resto de la cabecera se queda: el estado tiene que verse siempre. */
    const enMenu = section === "menu";
    if (back) back.hidden = enMenu;
    if (topbar) topbar.dataset.onMenu = String(enMenu);
    if (title) title.textContent = TITULOS[section] ?? section;

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
  back?.addEventListener("click", () => void irA("menu"));

  return { irA };
}
