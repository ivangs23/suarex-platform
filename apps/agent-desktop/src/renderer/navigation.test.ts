// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupNavigation } from "./navigation.js";

/**
 * Regresión de un fallo que llegó a la app: la navegación no respondía a NINGÚN clic.
 *
 * Fueron dos causas encadenadas, y las dos silenciosas -- la interfaz se veía perfecta:
 *
 *   1. El preload se emitía como `index.mjs` mientras `main` cargaba `index.js`. Electron
 *      no encontraba el fichero y no avisaba: la ventana se quedaba sin `window.agent`.
 *   2. Los listeners de navegación estaban DENTRO del `else` de "¿hay puente?", así que al
 *      faltar el puente la barra entera quedaba muerta -- justo cuando más falta hacía
 *      poder moverse por la app para leer el error.
 *
 * La (1) la cubre el arranque real; la (2) la cubre este fichero, que es la que convirtió
 * un fallo de configuración en una app inservible.
 */

const HTML = `
  <nav>
    <button class="tab" data-section="ajustes"></button>
    <button class="tab" data-section="impresoras"></button>
    <button class="tab" data-section="productos"></button>
    <button class="tab" data-section="pedidos"></button>
  </nav>
  <main>
    <section class="panel" data-panel="ajustes"></section>
    <section class="panel" data-panel="impresoras" hidden></section>
    <section class="panel" data-panel="productos" hidden>
      <div id="web-fallback-productos"></div>
    </section>
    <section class="panel" data-panel="pedidos" hidden>
      <div id="web-fallback-pedidos"></div>
    </section>
  </main>
`;

function boton(section: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    `.tab[data-section="${section}"]`,
  ) as HTMLButtonElement;
}

function visible(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".panel")]
    .filter((p) => !p.hidden)
    .map((p) => p.dataset.panel as string);
}

beforeEach(() => {
  document.body.innerHTML = HTML;
});

describe("navegación por pestañas", () => {
  it("un clic cambia de sección SIN puente IPC", async () => {
    // El fallo original: sin puente no se enganchaba ni un listener y la barra quedaba
    // muerta. Cambiar de sección es interfaz pura y no puede depender del IPC.
    setupNavigation(document);

    boton("impresoras").click();
    await Promise.resolve();

    expect(visible()).toEqual(["impresoras"]);
    expect(boton("impresoras").getAttribute("aria-current")).toBe("page");
    expect(boton("ajustes").hasAttribute("aria-current")).toBe(false);
  });

  it("avisa al proceso principal TAMBIÉN en las secciones locales", async () => {
    // La vista incrustada de la plataforma se superpone a esta zona: sin este aviso
    // seguiría tapando Ajustes al volver de Productos.
    const showSection = vi.fn(async (_section: string) => ({ ok: true }));
    const { irA } = setupNavigation(document, showSection);

    await irA("productos");
    await irA("ajustes");

    expect(showSection.mock.calls.map(([s]) => s)).toEqual(["productos", "ajustes"]);
  });

  it("cambia de sección aunque el proceso principal falle", async () => {
    // Un panel web que no carga no debe dejar atrapado al usuario en esa sección.
    const showSection = vi.fn(async (_section: string) => ({ ok: false }));
    const { irA } = setupNavigation(document, showSection);

    await irA("productos");
    expect(visible()).toEqual(["productos"]);

    await irA("impresoras");
    expect(visible()).toEqual(["impresoras"]);
  });

  it("explica en el propio panel por qué no se pudo cargar la sección web", async () => {
    const { irA } = setupNavigation(document, async () => ({ ok: false }));

    await irA("productos");

    const aviso = document.getElementById("web-fallback-productos") as HTMLElement;
    expect(aviso.textContent).toContain("PLATFORM_WEB_ORIGIN");
    // Y no ensucia el de la otra sección.
    expect(document.getElementById("web-fallback-pedidos")?.textContent).toBe("");
  });

  it("solo queda visible un panel a la vez", async () => {
    const { irA } = setupNavigation(document);

    for (const seccion of ["ajustes", "impresoras", "productos", "pedidos", "ajustes"]) {
      await irA(seccion);
      expect(visible()).toEqual([seccion]);
    }
  });

  it("una sección desconocida no deja nada visible en vez de dejar dos", async () => {
    // Degradar a "vacío" es preferible a dejar dos paneles superpuestos e ilegibles.
    const { irA } = setupNavigation(document);

    await irA("no-existe");

    expect(visible()).toEqual([]);
    expect([...document.querySelectorAll(".tab")].some((b) => b.hasAttribute("aria-current"))).toBe(
      false,
    );
  });
});

describe("accesos a una sección desde fuera de las pestañas", () => {
  it("un botón con data-ir-a lleva a su sección, aunque se cree después de arrancar", async () => {
    // La acción de una alerta («Ver impresoras») se pinta cuando llega el estado.
    setupNavigation(document);
    const accion = document.createElement("button");
    accion.dataset.irA = "impresoras";
    document.body.appendChild(accion);

    accion.click();
    await Promise.resolve();

    expect(visible()).toEqual(["impresoras"]);
    expect(boton("impresoras").getAttribute("aria-current")).toBe("page");
  });

  it("avisa de la sección a la que se entra, para cargar lo que necesite", async () => {
    const entradas: string[] = [];
    const { irA } = setupNavigation(document, undefined, (s) => entradas.push(s));
    await irA("ajustes");
    await irA("pedidos");
    expect(entradas).toEqual(["ajustes", "pedidos"]);
  });
});
