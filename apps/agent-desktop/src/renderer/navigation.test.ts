// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupNavigation } from "./navigation.js";

/**
 * Regresión de un fallo que llegó a la app: la barra lateral no respondía a NINGÚN clic.
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
    <button class="nav-item" data-section="config"></button>
    <button class="nav-item" data-section="impresoras"></button>
    <button class="nav-item" data-section="productos"></button>
    <button class="nav-item" data-section="pedidos"></button>
  </nav>
  <main>
    <section class="panel" data-panel="config"></section>
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
    `.nav-item[data-section="${section}"]`,
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

describe("navegación de la barra lateral", () => {
  it("un clic cambia de sección SIN puente IPC", async () => {
    // El fallo original: sin puente no se enganchaba ni un listener y la barra quedaba
    // muerta. Cambiar de sección es interfaz pura y no puede depender del IPC.
    setupNavigation(document);

    boton("impresoras").click();
    await Promise.resolve();

    expect(visible()).toEqual(["impresoras"]);
    expect(boton("impresoras").getAttribute("aria-selected")).toBe("true");
    expect(boton("config").getAttribute("aria-selected")).toBe("false");
  });

  it("avisa al proceso principal TAMBIÉN en las secciones locales", async () => {
    // La vista incrustada de la plataforma se superpone a esta zona: sin este aviso
    // seguiría tapando Configuración al volver de Productos.
    const showSection = vi.fn(async (_section: string) => ({ ok: true }));
    const { irA } = setupNavigation(document, showSection);

    await irA("productos");
    await irA("config");

    expect(showSection.mock.calls.map(([s]) => s)).toEqual(["productos", "config"]);
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

    for (const seccion of ["config", "impresoras", "productos", "pedidos", "config"]) {
      await irA(seccion);
      expect(visible()).toEqual([seccion]);
    }
  });

  it("una sección desconocida no deja nada visible en vez de dejar dos", async () => {
    // Degradar a "vacío" es preferible a dejar dos paneles superpuestos e ilegibles.
    const { irA } = setupNavigation(document);

    await irA("no-existe");

    expect(visible()).toEqual([]);
    expect(
      [...document.querySelectorAll(".nav-item")].every(
        (b) => b.getAttribute("aria-selected") === "false",
      ),
    ).toBe(true);
  });
});

describe("menú de inicio y vuelta atrás", () => {
  /** El armazón mínimo con lo que la navegación toca: cabecera, botón de atrás y dos paneles. */
  function conMenu() {
    const root = document.createElement("div");
    root.innerHTML = `
      <header class="topbar" data-on-menu="true">
        <button id="back" hidden>← Menú</button>
        <h1 id="topbar-title">SuarEx</h1>
      </header>
      <section class="panel menu" data-panel="menu">
        <button class="nav-item" data-section="config"></button>
        <button class="nav-item" data-section="pedidos"></button>
      </section>
      <section class="panel" data-panel="config" hidden></section>
      <section class="panel" data-panel="pedidos" hidden></section>`;
    return root;
  }

  it("en el inicio no hay botón de atrás: uno que no lleva a ningún sitio estorba", async () => {
    const root = conMenu();
    const { irA } = setupNavigation(root);
    await irA("menu");

    expect(root.querySelector<HTMLButtonElement>("#back")?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-panel="menu"]')?.hidden).toBe(false);
  });

  it("dentro de una sección aparece el atrás y el título dice dónde estás", async () => {
    const root = conMenu();
    const { irA } = setupNavigation(root);
    await irA("pedidos");

    expect(root.querySelector<HTMLButtonElement>("#back")?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>("#topbar-title")?.textContent).toBe("Comandas");
    expect(root.querySelector<HTMLElement>('[data-panel="menu"]')?.hidden).toBe(true);
  });

  it("el botón de atrás devuelve al menú", async () => {
    const root = conMenu();
    const { irA } = setupNavigation(root);
    await irA("config");

    root.querySelector<HTMLButtonElement>("#back")?.click();
    await Promise.resolve();

    expect(root.querySelector<HTMLElement>('[data-panel="menu"]')?.hidden).toBe(false);
    expect(root.querySelector<HTMLButtonElement>("#back")?.hidden).toBe(true);
  });

  it("al volver al menú se avisa al proceso principal, para que retire la vista incrustada", async () => {
    /* Sin ese aviso, la vista de la plataforma seguiría superpuesta y taparía el menú entero:
       el usuario vería las comandas con el botón de atrás encima y nada más. */
    const avisos: string[] = [];
    const root = conMenu();
    const { irA } = setupNavigation(root, async (s) => {
      avisos.push(s);
      return { ok: true };
    });

    await irA("pedidos");
    await irA("menu");
    expect(avisos).toEqual(["pedidos", "menu"]);
  });
});
